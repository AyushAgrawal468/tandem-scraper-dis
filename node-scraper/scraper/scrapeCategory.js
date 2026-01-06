const { autoScroll, delay } = require('./utils');

// 🔒 Hard limit to avoid runaway CPU on bad pages
const MAX_EVENTS_PER_CATEGORY = 80;

module.exports = async function scrapeCategory(
  browser,
  url,
  location,
  categoryTab
) {
  const page = await browser.newPage();

  try {
    // ---------------------------
    // 1️⃣ Block heavy resources
    // ---------------------------
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ---------------------------
    // 2️⃣ Minimal browser config
    // ---------------------------
    await page.setViewport({ width: 1280, height: 800 });
    await page.setGeolocation({ latitude: 0, longitude: 0 });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });

    await delay(3000);
    await autoScroll(page);

    // ---------------------------
    // 3️⃣ Extract event links
    // ---------------------------
    const eventLinks = await page.$$eval(
      'div.dds-grid a[href*="/events/"]',
      anchors =>
        [...new Set(
          anchors
            .map(a => a.href)
            .filter(href => href.includes('/events/'))
        )]
    );

    const linksToProcess = eventLinks.slice(0, MAX_EVENTS_PER_CATEGORY);
    const eventList = [];

    // ---------------------------
    // 4️⃣ Reuse ONE detail page
    // ---------------------------
    const detailPage = await browser.newPage();

    await detailPage.setRequestInterception(true);
    detailPage.on('request', req => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (const link of linksToProcess) {
      try {
        await detailPage.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000
        });

        await delay(2000);

        const data = await detailPage.evaluate(
          (loc, category, eventLink) => {
            const title =
              document.querySelector('h1')?.innerText || 'Untitled';

            const dateString =
              document.querySelector('[data-ref="edp_event_datestring_desktop"]')
                ?.textContent?.trim() || '';

            let eventDate = 'TBD';
            let eventTime = 'TBD';

            if (dateString.includes('|')) {
              const [d, t] = dateString.split('|').map(s => s.trim());
              eventDate = d || 'TBD';
              eventTime = t || 'TBD';
            }

            const image =
              document.querySelector('[data-ref="edp_event_banner_image"]')
                ?.src || '';

            const price =
              document.querySelector('[data-ref="edp_price_string_desktop"]')
                ?.textContent?.trim() || 'Free';

            const description = Array.from(
              document.querySelectorAll('.css-1gvk1lm p')
            )
              .map(el => el.textContent.trim())
              .filter(Boolean);

            const additionalImages = Array.from(
              document.querySelectorAll('.css-13n9y95 img')
            )
              .map(img => img.src)
              .filter(Boolean);

            const tags =
              document
                .querySelector('[data-ref="edp_event_category_desktop"]')
                ?.textContent?.split(',')
                .map(t => t.trim())
                .filter(Boolean) || [];

            return {
              title,
              category,
              eventDate,
              eventTime,
              image,
              location: loc,
              price,
              eventLink,
              description,
              additionalImages,
              tags
            };
          },
          location,
          categoryTab,
          link
        );

        eventList.push(data);
      } catch (err) {
        console.error(`❌ Failed: ${link} → ${err.message}`);
      }

      // 🧊 micro-cooldown prevents CPU spikes
      await delay(500);
    }

    await detailPage.close();
    return eventList;

  } finally {
    await page.close();
  }
};
