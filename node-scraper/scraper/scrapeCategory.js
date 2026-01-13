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
    // await page.setRequestInterception(true);
    // page.on('request', req => {
    //   const type = req.resourceType();  
    //   if (['image','media','font'].includes(type)) {
    //     req.abort();
    //   } else {
    //     req.continue();
    //   }
    // });

    // ---------------------------
    // 2️⃣ Minimal browser config
    // ---------------------------
    await page.setViewport({ width: 1280, height: 800 });
    await page.setGeolocation({ latitude: 0, longitude: 0 });

    console.log(`\n🌍 Opening category page: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });

    await delay(3000);
    await autoScroll(page);

    // ---------------------------
    // 3️⃣ Extract event links + posters
    // ---------------------------
    // wait until at least one real poster appears
await page.waitForFunction(() => {
  const imgs = Array.from(document.querySelectorAll('div.dds-grid img'));
  return imgs.some(img => img.src && img.src.startsWith('https://media.insider.in'));
}, { timeout: 20000 });

    const eventCards = await page.$$eval(
      'div.dds-grid a[href*="/events/"]',
      anchors => {
        const seen = new Set();

        return anchors.map(a => {
          const link = a.href;
          if (!link || seen.has(link)) return null;
          seen.add(link);

          const img = a.querySelector('img');
          const image = img?.src || '';

          return {
            link,
            image: image.startsWith('http') ? image : ''
          };
        }).filter(Boolean);
      }
    );


    const cardsToProcess = eventCards;
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

    for (const { link, image: poster } of cardsToProcess) {
      try {
        await detailPage.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000
        });

        await delay(2000);

        const data = await detailPage.evaluate(
          (loc, category, eventLink, poster) => {
            const title =
              document.querySelector('h1')?.innerText || 'Untitled';

            const dateString =
              document.querySelector('[data-ref="edp_event_datestring_desktop"]')
                ?.textContent?.trim() || '';

            let eventDate = dateString;
            let eventTime = 'TBD';

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

            if (loc == 'new-delhi' || loc == 'noida' || loc == 'gurgaon' || loc == 'faridabad' || loc == 'ghaziabad') {
              loc = 'Delhi-NCR';
            } else if (loc == 'bangalore') {
              loc = 'Bengaluru';
            } else if (loc == 'chennai') {
              loc = 'Chennai';
            }

            return {
              title,
              category,
              eventDate,
              eventTime,
              image,
              poster,
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
          link,
          poster
        );

        eventList.push(data);

        console.log("\n🧩 EVENT");
        console.log(` Title        : ${data.title}`);
        console.log(` Link         : ${data.eventLink}`);
        console.log(` Grid Poster  : ${poster || "NONE"}`);
        console.log(` Detail Image : ${data.image || "NONE"}`);
        console.log("────────────────────────────────────");

      } catch (err) {
        console.error(`❌ Failed: ${link} → ${err.message}`);
      }

      await delay(500);
    }

    await detailPage.close();
    return eventList;

  } finally {
    await page.close();
  }
};
