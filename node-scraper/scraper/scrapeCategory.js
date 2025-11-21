// scraper/scrapeCategory.js
// Scrapes a category page on district.in
// Exports: async function scrapeCategory(browser, url, location, categoryTab, options)

const { autoScroll, delay } = require("./utils");
const chalk = require("chalk");

/**
 * Open a URL in a fresh page with retries and timeout per attempt.
 * Returns { success: true, page } or { success: false, error }
 */
async function openWithRetries(browser, url, {
  maxAttempts = 3,
  attemptTimeoutMs = 30000,
  waitUntil = "networkidle2"
} = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let page;
    try {
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(attemptTimeoutMs);
      page.setDefaultTimeout(attemptTimeoutMs);
      await page.goto(url, { waitUntil, timeout: attemptTimeoutMs });
      return { success: true, page };
    } catch (err) {
      lastErr = err;
      try {
        if (page && !page.isClosed()) await page.close();
      } catch (_) {}
      const backoffMs = Math.min(5000, 500 * attempt);
      console.warn(chalk.yellow(
        `[WARN] openWithRetries failed for ${url} (attempt ${attempt}): ${err.message || err}`
      ));
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  return { success: false, error: lastErr };
}

module.exports = async function scrapeCategory(
  browser,
  url,
  location,
  categoryTab,
  {
    maxEventsToCollect = 200,
    perEventMaxAttempts = 3,
    perEventAttemptTimeoutMs = 30000,
    maxConsecutiveFailures = 5,
    listingMaxAttempts = 2,
    listingTimeoutMs = 30000
  } = {}
) {
  const eventList = [];
  let consecutiveFailures = 0;

  // Ensure geolocation permissions like your working version
  const context = browser.defaultBrowserContext();
  await context.overridePermissions("https://www.district.in", ["geolocation"]);

  // --- Load listing page with retries ---
  const listingResult = await openWithRetries(browser, url, {
    maxAttempts: listingMaxAttempts,
    attemptTimeoutMs: listingTimeoutMs,
    waitUntil: "networkidle2"
  });

  if (!listingResult.success) {
    console.error(
      chalk.red(`[ERROR] Failed to load listing ${url}: ${listingResult.error?.message || listingResult.error}`)
    );
    return eventList;
  }

  const listingPage = listingResult.page;

  try {
    // Set dummy geolocation (like working version)
    await listingPage.setGeolocation({ latitude: 0, longitude: 0 });

    await delay(8000);          // let dynamic content load
    await autoScroll(listingPage);

    // Setup extended URL path based on category
    let extendedUrl = "";
    switch (categoryTab) {
      case "Events":
      case "Activities":
        extendedUrl = "/events/";
        break;
      default:
        extendedUrl = "";
        break;
    }

    // Use the known-working selector for event links
    const eventLinks = await listingPage.$$eval(
      `div.dds-grid a[href*="${extendedUrl}"]`,
      anchors => {
        return anchors
          .filter(a => {
            const text = a.innerText?.trim() || "";
            return text.length > 0 && a.href.includes("/events/");
          })
          .map(a => a.href);
      }
    );

    console.log(
      chalk.blue(`[INFO] Found ${eventLinks.length} links on listing ${url} (${categoryTab} / ${location})`)
    );

    // --- Iterate event links with retries per event ---
    for (const link of eventLinks) {
      if (eventList.length >= maxEventsToCollect) break;

      const { success, page: detailPage, error } = await openWithRetries(browser, link, {
        maxAttempts: perEventMaxAttempts,
        attemptTimeoutMs: perEventAttemptTimeoutMs,
        waitUntil: "networkidle2"
      });

      if (!success) {
        console.error(
          chalk.red(`[ERROR] Failed to load event ${link}: ${error?.message || error}`)
        );
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.warn(
            chalk.yellow(
              `[WARN] ${consecutiveFailures} consecutive event failures — aborting category ${url}`
            )
          );
          break;
        }
        continue;
      }

      // Reset failure streak on success
      consecutiveFailures = 0;

      try {
        await delay(5000);

        const data = await detailPage.evaluate(
          async (loc, categoryTab, link) => {
            const title = document.querySelector("h1")?.innerText || "Untitled";

            const eventDateAndTime =
              document.querySelector('[data-ref="edp_event_datestring_desktop"]')?.textContent?.trim() ||
              "Date not found";

            let eventDate = "TBD";
            let eventTime = "TBD";
            if (eventDateAndTime !== "Date not found") {
              const parts = eventDateAndTime
                .split("|")
                .map(part => part.trim())
                .filter(Boolean);
              if (parts[0]) eventDate = parts[0];
              if (parts[1]) eventTime = parts[1];
            }

            const image =
              document.querySelector('[data-ref="edp_event_banner_image"]')?.src || "";

            const price =
              document.querySelector('[data-ref="edp_price_string_desktop"]')?.textContent.trim() ||
              "Free";

            const description = Array.from(
              document.querySelectorAll(".css-1gvk1lm p")
            )
              .map(el => el.textContent.trim())
              .filter(text => text.length > 0);

            const additionalImages = Array.from(
              document.querySelectorAll(".css-13n9y95 img")
            )
              .map(img => img.src)
              .filter(Boolean);

            let tags =
              document.querySelector('[data-ref="edp_event_category_desktop"]')?.textContent.trim() ||
              "";
            tags = tags
              ? tags.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0)
              : [];

            return {
              title,
              category: categoryTab,
              eventDate,
              eventTime,
              image,
              location: loc,
              price,
              eventLink: link,
              description,
              additionalImages,
              tags
            };
          },
          location,
          categoryTab,
          link
        );

        console.log(`\n📝 Event: ${data.title}`);
        console.log(`📄 Description: ${JSON.stringify(data.description, null, 2)}`);
        console.log(`🏷️ Tags: ${JSON.stringify(data.tags, null, 2)}`);
        console.log(`───────────────────────────────────────`);

        eventList.push(data);
      } catch (e) {
        console.error(`❌ Error scraping ${link}: ${e.message}`);
      } finally {
        try {
          await detailPage.close();
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error(
      chalk.red(`[ERROR] scrapeCategory failed for ${url}: ${err?.message || err}`)
    );
  } finally {
    try {
      if (listingPage && !listingPage.isClosed()) await listingPage.close();
    } catch (_) {}
  }

  console.log(
    `\n✅ Finished scraping ${eventList.length} events from "${categoryTab}" in ${location}`
  );
  return eventList;
};