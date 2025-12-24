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
  await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 30000 });
  
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
    //  detailPage.on("console", msg => {
    //       console.log(`📜 [BROWSER LOG]: ${msg.text()}`);
    //     });
    console.log(`"${link}"`);
    try {
      await detailPage.goto(link, { waitUntil: "networkidle2", timeout: 0 });
      await delay(5000);

      const data = await detailPage.evaluate(
        async (loc, categoryTab,link) => {
          const title = document.querySelector("h1")?.innerText || "Untitled";
          const eventDateAndTime = document.querySelector('[data-ref="edp_event_datestring_desktop"]')?.textContent?.trim() || "Date not found";

          let eventDate = "TBD";
          let eventTime = "TBD";
          if (eventDateAndTime !== "Date not found") {
            const parts = eventDateAndTime.split("|").map(part => part.trim());
            if (parts.length > 0 && parts[0]) {
              eventDate = parts[0];
            }
            if (parts.length > 1 && parts[1]) {
              eventTime = parts[1];
            }
          }
          let image = document.querySelector('[data-ref="edp_event_banner_image"]')?.src || "";
          let price = document.querySelector('[data-ref="edp_price_string_desktop"]')?.textContent.trim() || "Free";

          let description = Array.from(document.querySelectorAll(".css-1gvk1lm p")).map(el => el.textContent.trim()).filter(text => text.length > 0);
          
          let additionalImages = Array.from(document.querySelectorAll('.css-13n9y95 img')).map(img => img.src).filter(src => src);
          let tags = document.querySelector('[data-ref="edp_event_category_desktop"]')?.textContent.trim() || "";
          tags = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0) : [];

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
      
      // Print description for each event
      console.log(`\n📝 Event: ${data.title}`);
      console.log(`📄 Description: ${JSON.stringify(data.description, null, 2)}`);
      console.log(`🏷️ Tags: ${JSON.stringify(data.tags, null, 2)}`);
      console.log(`───────────────────────────────────────`);
      
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
