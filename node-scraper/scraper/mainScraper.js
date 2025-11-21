// scraper/mainScraper.js
// Main scraper that pairs with scraper/scrapeCategory.js
// Usage: const mainScraper = require('./mainScraper');
// await mainScraper(baseUrl, callbackUrl, options);

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const scrapeCategory = require('./scrapeCategory');

puppeteer.use(StealthPlugin());

// --- Configuration lists (same as outer working version) ---
const LOCATIONS = [
  'indore','mumbai','new-delhi','bangalore','hyderabad','chennai',
  'pune','kolkata','ahmedabad','jaipur','gurgaon','noida','chandigarh'
];
const CATEGORY_TABS = ['Activities','Events'];
const SUB_CATEGORY_EVENT_LIST = [
  'music', 'comedy', 'nightlife','performances','sports','food-drinks',
  'fests-fairs','social-mixers','screenings','fitness','conferences',
  'expos','art-exhibitions'
];
const SUB_CATEGORY_ACTIVITY_LIST = [
  'theme-parks', 'water-parks', 'adventure','game-zones','kids-play',
  'workshops','games-quizzes','art-craft','fitness','pets','esports','museums'
];

const CATEGORY_SUBCATEGORIES = {
  Events: SUB_CATEGORY_EVENT_LIST,
  Activities: SUB_CATEGORY_ACTIVITY_LIST,
};

// --- Defaults / retry config ---
const DEFAULT_BROWSER_OPTIONS = {
  headless: false, // like your working version; set true for headless
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};
const DEFAULT_MAX_EVENTS = 500; // test cap; set to null for unlimited
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
      console.warn(
        chalk.yellow(
          `[WARN] callback post failed (attempt ${attempt}/${maxRetries}): ${err.message || err}`
        )
      );
      if (attempt < maxRetries) {
        const waitMs = Math.min(5000, 500 * attempt);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  console.error(
    chalk.red(`[ERROR] Callback failed after ${maxRetries} attempts: ${lastErr?.message || lastErr}`)
  );
  return { success: false, posted: 0, error: lastErr };
}

/**
 * Default category URL builder: matches your working outer mainScraper
 * baseUrl is expected to be "https://www.district.in/events"
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
    const fullPath = path.join(outDir, fname);
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf-8');
    console.info(chalk.blue(`[INFO] Persisted failed batch to ${fullPath}`));
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
 *  - buildCategoryUrl (fn)
 *  - batchPostRetries (number)
 *  - batchPostTimeoutMs (number)
 *  - persistFailedBatches (boolean)
 *  - failedBatchDir (string)
 *  - scrapeCategoryOptions (object) -> passed directly to scraper/scrapeCategory.js
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
  const scrapeCategoryOptions = options.scrapeCategoryOptions || {};

  let totalEvents = 0;
  let totalCategories = 0;
  let totalFailedBatches = 0;

  outerLoop: for (const location of locations) {
    let browser;
    try {
      browser = await puppeteer.launch(browserOptions);
    } catch (err) {
      console.error(
        chalk.red(`[ERROR] Failed to launch browser for ${location}: ${err.message || err}`)
      );
      continue;
    }

    try {
      for (const categoryTab of CATEGORY_TABS) {
        const subCategories = CATEGORY_SUBCATEGORIES[categoryTab] || [];

        for (const subCategory of subCategories) {
          // stop early if test cap reached
          if (maxEvents && totalEvents >= maxEvents) {
            console.info(
              chalk.blue(
                `[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`
              )
            );
            try { await browser.close(); } catch (_) {}
            break outerLoop;
          }

          totalCategories++;
          const categoryUrl = buildCategoryUrl(baseUrl, location, subCategory);
          console.info(
            chalk.yellow(
              `[INFO] Scraping: ${categoryTab} / ${subCategory} in ${location} -> ${categoryUrl}`
            )
          );

          let eventsForCategory = [];
          try {
            eventsForCategory = await scrapeCategory(
              browser,
              categoryUrl,
              location,
              categoryTab,
              scrapeCategoryOptions
            );
          } catch (err) {
            console.error(
              chalk.red(
                `[ERROR] scrapeCategory failed for ${location}/${categoryTab}/${subCategory}: ${err?.message || err}`
              )
            );
            continue;
          }

          // cap per overall maxEvents
          let eventsToPost = Array.isArray(eventsForCategory) ? eventsForCategory : [];
          if (maxEvents && totalEvents < maxEvents) {
            eventsToPost = eventsToPost.slice(0, Math.max(0, maxEvents - totalEvents));
          }

          console.log(
            chalk.green(
              `[✓] Collected ${eventsToPost.length} events for ${subCategory} in ${location}`
            )
          );

          if (eventsToPost.length > 0) {
            const { success, posted, error } = await postWithRetry(callbackUrl, eventsToPost, {
              maxRetries: batchPostRetries,
              timeoutMs: batchPostTimeoutMs
            });

            if (success) {
              totalEvents += posted;
              console.info(
                chalk.green(
                  `[INFO] Posted ${posted} events for ${subCategory} in ${location} (totalEvents=${totalEvents})`
                )
              );
            } else {
              totalFailedBatches++;
              console.error(
                chalk.red(
                  `[ERROR] Failed to post batch for ${subCategory} in ${location}: ${error?.message || error}`
                )
              );
              if (persistFailedBatches) {
                persistFailedBatch(failedBatchDir, location, subCategory, eventsToPost);
              }
            }
          } else {
            console.info(
              chalk.blue(`[INFO] No events to post for ${subCategory} in ${location}`)
            );
          }

          if (maxEvents && totalEvents >= maxEvents) {
            console.info(
              chalk.blue(
                `[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`
              )
            );
            try { await browser.close(); } catch (_) {}
            break outerLoop;
          }
        }
      }
    } finally {
      try { if (browser) await browser.close(); } catch (_) {}
    }
  }

  return {
    status: 'completed',
    totalEvents,
    totalCategories,
    totalFailedBatches
  };
};