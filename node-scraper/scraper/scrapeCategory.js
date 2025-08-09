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
     detailPage.on("console", msg => {
          console.log(`📜 [BROWSER LOG]: ${msg.text()}`);
        });
    console.log(`"${link}"`);
    try {
      await detailPage.goto(link, { waitUntil: "networkidle2", timeout: 0 });
      await delay(5000);

      const data = await detailPage.evaluate(
        (loc, categoryTab,link) => {
          const title = document.querySelector("h1")?.innerText || "Untitled";
          const eventDateAndTime = document.querySelector('[data-ref="edp_event_datestring_desktop"]')?.textContent?.trim() || "Date not found";

          let eventDate = "TBD";
          let eventTime = "TBD";
          console.log("Raw event date & time text:", `"${eventDateAndTime}"`);
          if (eventDateAndTime !== "Date not found") {
            const parts = eventDateAndTime.split("|").map(part => part.trim());
            console.log("Split parts:", parts);
            if (parts.length > 0 && parts[0]) {
              eventDate = parts[0];
            }
            if (parts.length > 1 && parts[1]) {
              eventTime = parts[1];
            }
            console.log(`Parsed Event Date: "${eventDate}"`);
              console.log(`Parsed Event Time: "${eventTime}"`);
          }
          let image = document.querySelector('[data-ref="edp_event_banner_image"]')?.src || "";
          let price = document.querySelector('[data-ref="edp_price_string_desktop"]')?.textContent.trim() || "Free";

          return {
            title,
            category: categoryTab,
            eventDate,
            eventTime,
            image,
            location: loc,
            price,
            eventLink: link
          };
        },
        location,
        categoryTab,
        link
      );
      eventList.push(data);
    } catch (e) {
      console.error(`❌ Error scraping ${link}: ${e.message}`);
    } finally {
      await detailPage.close();
    }
  }

  await page.close();
  console.log(`\n✅ Finished scraping ${eventList.length} events from "${categoryTab}"`);
  return eventList;
};
