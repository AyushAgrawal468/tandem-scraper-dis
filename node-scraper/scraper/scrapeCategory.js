const { autoScroll, delay } = require("./utils");

module.exports = async function scrapeCategory(
  browser,
  url,
  location,
  categoryTab,
) {

     const context = browser.defaultBrowserContext(); // ✅ context comes from browser
     await context.overridePermissions("https://www.district.in", ['geolocation']); // or empty array if denying

     const page = await browser.newPage();

      // ✅ Set geolocation permission for the page
      await page.setGeolocation({ latitude: 0, longitude: 0 }); // dummy location
  await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });


  await delay(8000);


  await autoScroll(page);
  // Setup extended URL path based on category
  let extendedUrl = "";
  switch (categoryTab) {
    case "Events":
      extendedUrl = "/events/";
      break;
    case "Activities":
      extendedUrl = "/events/";
      break;
    default:
      extendedUrl = "";
      break;
  }

  const eventLinks = await page.$$eval(
      `div.dds-grid a[href*="${extendedUrl}"]`,
      (anchors) => {
        return anchors
          .filter((a) => {
            const text = a.innerText?.trim() || "";
            return text.length > 0 && a.href.includes("/events/");
          })
          .map((a) => a.href);
      }
    );

  const eventList = [];

  for (const [index, link] of eventLinks.entries()) {

    const detailPage = await browser.newPage();

    try {
      await detailPage.goto(link, { waitUntil: "networkidle2", timeout: 0 });
      await delay(5000);

      const data = await detailPage.evaluate(
        (loc, categoryTab) => {
          const title = document.querySelector("h1")?.innerText || "Untitled";

            const eventDate = document.querySelector('[data-ref="edp_event_datestring_desktop"]')?.textContent.trim() || "Date not found";

          let image = document.querySelector('[data-ref="edp_event_banner_image"]')?.src || "";

          let price = document.querySelector('[data-ref="edp_price_string_desktop"]')?.textContent.trim() || "Free";

          return {
            title,
            category: categoryTab,
            eventDate,
            image,
            location: loc,
            price
          };
        },
        location,
        categoryTab
      );
      eventList.push(data);
    } catch (e) {
      console.error(`❌ Error scraping ${link}: ${e.message}`);
    } finally {
      await detailPage.close();
    }

    // Optional: Stop after N events (for testing)
    if (eventList.length >= 10) {
      console.log("🧪 Collected 10 events — stopping early for test.");
      break;
    }
  }

  await page.close();
  console.log(`\n✅ Finished scraping ${eventList.length} events from "${categoryTab}"`);
  return eventList;
};
