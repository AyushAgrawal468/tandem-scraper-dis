// mainScraper.js
// Ready-to-paste main scraper that pairs with scrapeCategory.js
// Usage: const mainScraper = require('./mainScraper');
// await mainScraper(baseUrl, callbackUrl, options);

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const scrapeCategory = require('./scrapeCategory'); // expects the scrapeCategory implementation provided earlier
puppeteer.use(StealthPlugin());

// --- Configuration lists (edit as needed) ---
const LOCATIONS = ['indore','mumbai','new-delhi','bangalore','hyderabad','chennai','pune','kolkata','ahmedabad','jaipur','gurgaon','noida','chandigarh'];
const CATEGORY_TABS = ['Activities','Events'];
const SUB_CATEGORY_EVENT_LIST = ['music', 'comedy', 'nightlife','performances','sports','food-drinks','fests-fairs','social-mixers','screenings','fitness','conferences','expos','art-exhibitions'];
const SUB_CATEGORY_ACTIVITY_LIST = ['theme-parks', 'water-parks', 'adventure','game-zones','kids-play','workshops','games-quizzes','art-craft','fitness','pets','esports','museums'];
const CATEGORY_SUBCATEGORIES = {
  Events: SUB_CATEGORY_EVENT_LIST,
  Activities: SUB_CATEGORY_ACTIVITY_LIST,
};

// --- Defaults ---
const DEFAULT_BROWSER_OPTIONS = { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] };
const DEFAULT_MAX_EVENTS = null; // null = unlimited
const DEFAULT_BATCH_POST_RETRIES = 5;
const DEFAULT_BATCH_POST_TIMEOUT_MS = 15000;
const DEFAULT_PERSIST_FAILED_BATCHES = false;
const DEFAULT_FAILED_BATCH_DIR = path.resolve(process.cwd(), 'failed_batches');

/**
 * Post payload to callbackUrl with retries and simple backoff.
 * Returns { success: boolean, posted: number, error?: Error }
 */
async function postWithRetry(callbackUrl, payload, {
  maxRetries = DEFAULT_BATCH_POST_RETRIES,
  timeoutMs = DEFAULT_BATCH_POST_TIMEOUT_MS
} = {}) {
  if (!payload || payload.length === 0) return { success: true, posted: 0 };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await axios.post(callbackUrl, payload, { timeout: timeoutMs });
      return { success: true, posted: payload.length };
    } catch (err) {
      lastErr = err;
      console.warn(chalk.yellow(`[WARN] callback post failed (attempt ${attempt}/${maxRetries}): ${err.message || err}`));
      if (attempt < maxRetries) {
        const waitMs = Math.min(5000, 500 * attempt);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  console.error(chalk.red(`[ERROR] Callback failed after ${maxRetries} attempts: ${lastErr?.message || lastErr}`));
  return { success: false, posted: 0, error: lastErr };
}

/**
 * Default category list provider (can be overridden via options.getCategoriesForLocation)
 */
async function defaultGetCategoriesForLocation(location) {
  // return combined subcategories for Events and Activities for simplicity;
  // main loop uses CATEGORY_TABS to pick correct list
  return CATEGORY_SUBCATEGORIES;
}

/**
 * Default category URL builder (override via options.buildCategoryUrl)
 */
function defaultBuildCategoryUrl(baseUrl, location, subCategory) {
  return `${baseUrl.replace(/\/$/, '')}/${subCategory.toLowerCase()}-in-${location}-book-tickets`;
}

/**
 * Persist failed batch to disk (JSON)
 */
function persistFailedBatch(outDir, location, subCategory, payload) {
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const fname = `${Date.now()}_${location}_${subCategory}.json`.replace(/\s+/g, '_');
    fs.writeFileSync(path.join(outDir, fname), JSON.stringify(payload, null, 2), 'utf-8');
    console.info(chalk.blue(`[INFO] Persisted failed batch to ${path.join(outDir, fname)}`));
  } catch (e) {
    console.error(chalk.red(`[ERROR] Failed to persist failed batch: ${e.message || e}`));
  }
}

/**
 * Main export
 * options:
 *  - locations (array)
 *  - browserOptions (puppeteer.launch options)
 *  - maxEvents (number or null)
 *  - getCategoriesForLocation (fn) - not used here directly, kept for extensibility
 *  - buildCategoryUrl (fn)
 *  - batchPostRetries (number)
 *  - batchPostTimeoutMs (number)
 *  - persistFailedBatches (boolean)
 *  - failedBatchDir (string)
 */
module.exports = async function mainScraper(baseUrl, callbackUrl, options = {}) {
  if (!baseUrl) throw new Error('baseUrl required');
  if (!callbackUrl) throw new Error('callbackUrl required');

  const locations = options.locations || LOCATIONS;
  const browserOptions = options.browserOptions || DEFAULT_BROWSER_OPTIONS;
  const maxEvents = typeof options.maxEvents === 'number' ? options.maxEvents : DEFAULT_MAX_EVENTS;
  const buildCategoryUrl = options.buildCategoryUrl || defaultBuildCategoryUrl;
  const batchPostRetries = options.batchPostRetries || DEFAULT_BATCH_POST_RETRIES;
  const batchPostTimeoutMs = options.batchPostTimeoutMs || DEFAULT_BATCH_POST_TIMEOUT_MS;
  const persistFailedBatches = options.persistFailedBatches ?? DEFAULT_PERSIST_FAILED_BATCHES;
  const failedBatchDir = options.failedBatchDir || DEFAULT_FAILED_BATCH_DIR;

  let totalEvents = 0;
  let totalCategories = 0;
  let totalFailedBatches = 0;

  outerLoop: for (const location of locations) {
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
    } catch (err) {
      console.error(chalk.red(`[ERROR] Failed to launch browser for ${location}: ${err.message || err}`));
      continue;
    }

    try {
      for (const categoryTab of CATEGORY_TABS) {
        const subCategories = CATEGORY_SUBCATEGORIES[categoryTab] || [];
        for (const subCategory of subCategories) {
          totalCategories++;
          const categoryUrl = buildCategoryUrl(baseUrl, location, subCategory);
          console.info(chalk.cyan(`[INFO] Scraping category: ${categoryTab} / ${subCategory} @ ${location} -> ${categoryUrl}`));

          let eventsForCategory = [];
          try {
            // scrapeCategory should implement per-event timeouts/retries and return array
            eventsForCategory = await scrapeCategory(browser, categoryUrl, location, categoryTab, options.scrapeCategoryOptions || {});
          } catch (err) {
            console.error(chalk.red(`[ERROR] scrapeCategory failed for ${location}/${subCategory}: ${err?.message || err}`));
            // skip posting for this category
            continue;
          }

          // Apply maxEvents cap (for testing). If maxEvents is null, skip slicing.
          let eventsToAdd = Array.isArray(eventsForCategory) ? eventsForCategory : [];
          if (maxEvents && totalEvents < maxEvents) {
            eventsToAdd = eventsToAdd.slice(0, Math.max(0, maxEvents - totalEvents));
          } else if (maxEvents && totalEvents >= maxEvents) {
            console.info(chalk.blue(`[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`));
            // close browser and break everything
            try { await browser.close(); } catch (e) { /* ignore */ }
            break outerLoop;
          }

          console.log(chalk.green(`[✓] Collected ${eventsToAdd.length} events for ${subCategory} in ${location}`));

          if (eventsToAdd.length > 0) {
            const { success, posted, error } = await postWithRetry(callbackUrl, eventsToAdd, {
              maxRetries: batchPostRetries,
              timeoutMs: batchPostTimeoutMs
            });

            if (success) {
              totalEvents += posted;
              console.info(chalk.green(`[INFO] Posted ${posted} events for ${subCategory} in ${location} (totalEvents=${totalEvents})`));
            } else {
              totalFailedBatches++;
              console.error(chalk.red(`[ERROR] Failed to post batch for ${subCategory} in ${location}: ${error?.message || error}`));
              if (persistFailedBatches) persistFailedBatch(failedBatchDir, location, subCategory, eventsToAdd);
            }
          } else {
            console.info(chalk.blue(`[INFO] No events to post for ${subCategory} in ${location}`));
          }

          // If we've reached the maxEvents after posting, stop everything.
          if (maxEvents && totalEvents >= maxEvents) {
            console.info(chalk.blue(`[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`));
            try { await browser.close(); } catch (e) { /* ignore */ }
            break outerLoop;
          }
        } // end subCategory loop
      } // end categoryTab loop
    } finally {
      try { if (browser) await browser.close(); } catch (e) { /* ignore close errors */ }
    }
  } // end locations loop

  return {
    status: 'completed',
    totalEvents,
    totalCategories,
    totalFailedBatches
  };
};
