// scrapeCategory.js
// Exports: async function scrapeCategory(browser, categoryUrl, location, categoryTab)
// Returns: Array of event objects for that subcategory

const chalk = require('chalk');

/**
 * Auto-scroll helper for listing pages
 */
async function autoScroll(page, scrollDelay = 250, maxScrolls = 100) {
  await page.evaluate(
    async (scrollDelay, maxScrolls) => {
      const distance = 1000;
      let scrolled = 0;
      for (let i = 0; i < maxScrolls; i++) {
        window.scrollBy(0, distance);
        await new Promise(r => setTimeout(r, scrollDelay));
        scrolled += distance;
      }
    },
    scrollDelay,
    maxScrolls
  );
}

/**
 * Open a URL in a fresh page with retries and timeout per attempt.
 * Returns { success: true, page } or { success: false, error }
 */
async function openWithRetries(browser, url, {
  maxAttempts = 3,
  attemptTimeoutMs = 10000,
  waitUntil = 'domcontentloaded'
} = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let page;
    try {
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(attemptTimeoutMs);
      page.setDefaultTimeout(attemptTimeoutMs);
      await page.goto(url, { timeout: attemptTimeoutMs, waitUntil });
      return { success: true, page };
    } catch (err) {
      lastErr = err;
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (e) { /* ignore close error */ }
      const backoffMs = Math.min(5000, 500 * attempt);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  return { success: false, error: lastErr };
}

/**
 * Extract event links from listing page.
 * Adjust selector logic to match the site's DOM.
 */
async function collectEventLinksFromListing(page) {
  // Example: adjust selector to your site's event card anchors
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a'));
    // Filter anchors that look like event links (heuristic)
    return anchors
      .map(a => a.href)
      .filter(href => href && href.includes('/events/'))
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  });
  return links;
}

/**
 * Extract structured event data from a detail page.
 * Update selectors to match actual detail page markup.
 */
async function extractEventFromPage(page, sourceUrl, location, categoryTab) {
  // Example extraction — adapt selectors for the real site
  const data = await page.evaluate((sourceUrl, location, categoryTab) => {
    const safeText = (sel) => {
      try { return document.querySelector(sel)?.innerText?.trim() ?? null; } catch { return null; }
    };
    const safeAttr = (sel, attr) => {
      try { return document.querySelector(sel)?.getAttribute(attr) ?? null; } catch { return null; }
    };

    const title = safeText('h1') || safeText('.event-title') || safeText('.title');
    const image = safeAttr('img', 'src') || safeAttr('.hero img', 'src');
    const date = safeText('.date') || safeText('.event-date') || null;
    const time = safeText('.time') || null;
    const locationText = safeText('.location') || safeText('.venue') || null;
    const description = (() => {
      const el = document.querySelector('.description') || document.querySelector('.event-desc');
      if (!el) return null;
      return Array.from(el.querySelectorAll('p')).map(p => p.innerText.trim()).filter(Boolean);
    })();
    const price = safeText('.price') || null;
    const tags = Array.from(document.querySelectorAll('.tags .tag')).map(t => t.innerText.trim()).filter(Boolean);

    return {
      title,
      image,
      eventDate: date,
      eventTime: time,
      location: locationText,
      description,
      price,
      tags,
      sourceLink: sourceUrl,
      scrapingSource: 'district.in',
      scrapedAt: new Date().toISOString(),
      scrapedLocation: location,
      categoryTab
    };
  }, sourceUrl, location, categoryTab);

  return data;
}

/**
 * Main scrapeCategory implementation.
 */
module.exports = async function scrapeCategory(browser, categoryUrl, location, categoryTab, {
  listingTimeoutMs = 15000,
  maxEventsToCollect = 200,
  perEventMaxAttempts = 3,
  perEventAttemptTimeoutMs = 10000,
  maxConsecutiveFailures = 5
} = {}) {
  const eventList = [];
  let consecutiveFailures = 0;

  let listingPage;
  try {
    // Open listing page (single attempt here; listing hangs are less common)
    listingPage = await browser.newPage();
    listingPage.setDefaultNavigationTimeout(listingTimeoutMs);
    listingPage.setDefaultTimeout(listingTimeoutMs);

    // If the listing page sometimes needs a specific user-agent or headers, set them here.
    await listingPage.goto(categoryUrl, { timeout: listingTimeoutMs, waitUntil: 'domcontentloaded' });

    // Auto-scroll to load lazy items
    try { await autoScroll(listingPage, 300, 60); } catch (e) { /* ignore scroll errors */ }

    // collect event links
    const eventLinks = await collectEventLinksFromListing(listingPage);
    console.log(chalk.blue(`[INFO] Found ${eventLinks.length} links on listing ${categoryUrl}`));

    // iterate event links
    for (const link of eventLinks) {
      if (eventList.length >= maxEventsToCollect) break;

      // load detail page with retries
      const { success, page, error } = await openWithRetries(browser, link, {
        maxAttempts: perEventMaxAttempts,
        attemptTimeoutMs: perEventAttemptTimeoutMs,
        waitUntil: 'domcontentloaded'
      });

      if (!success) {
        console.error(chalk.red(`[ERROR] Failed to load event ${link}: ${error?.message || error}`));
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.warn(chalk.yellow(`[WARN] ${consecutiveFailures} consecutive event failures — aborting category ${categoryUrl}`));
          break;
        }
        continue; // move to next link
      }

      // loaded successfully; reset consecutive failures
      consecutiveFailures = 0;

      try {
        // Small stabilization wait if needed
        await page.waitForTimeout(300);

        // Extract event data
        const eventData = await extractEventFromPage(page, link, location, categoryTab);
        eventList.push(eventData);
        console.log(chalk.green(`[✓] Scraped event: ${eventData.title ?? eventData.sourceLink}`));
      } catch (procErr) {
        console.error(chalk.red(`[ERROR] Processing ${link}: ${procErr?.message || procErr}`));
      } finally {
        // ensure page closed
        try { if (page && !page.isClosed()) await page.close(); } catch (e) { /* ignore */ }
      }
    }
  } catch (err) {
    console.error(chalk.red(`[ERROR] scrapeCategory failed for ${categoryUrl}: ${err?.message || err}`));
  } finally {
    // Close listing page
    try { if (listingPage && !listingPage.isClosed()) await listingPage.close(); } catch (e) { /* ignore */ }
  }

  return eventList;
};
