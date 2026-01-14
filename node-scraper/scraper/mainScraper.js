const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const scrapeCategory = require('./scrapeCategory');
const axios = require('axios');
const pLimit = require('p-limit');

puppeteer.use(StealthPlugin());

const LOCATIONS = [
  'new-delhi','indore', 'bengaluru', 'mumbai', 'hyderabad',
  'chennai', 'pune', 'kolkata', 'ahmedabad', 'jaipur',
  'gurgaon', 'noida', 'chandigarh'
];

const CATEGORY_TABS = ['Activities', 'Events'];

const SUB_CATEGORY_EVENT_LIST = [
  'music', 'comedy', 'nightlife', 'performances', 'sports',
  'food-drinks', 'fests-fairs', 'social-mixers', 'screenings',
  'fitness', 'conferences', 'expos', 'art-exhibitions'
];

const SUB_CATEGORY_ACTIVITY_LIST = [
  'adventure','theme-parks', 'water-parks', 'game-zones',
  'kids-play', 'workshops', 'games-quizzes', 'art-craft',
  'fitness', 'pets', 'esports', 'museums'
];

const CATEGORY_SUBCATEGORIES = {
  Events: SUB_CATEGORY_EVENT_LIST,
  Activities: SUB_CATEGORY_ACTIVITY_LIST
};

// Max parallel category scrapes
const limit = pLimit(1);

// Safety cap (set null for full run)
const MAX_EVENTS = null;

module.exports = async function mainScraper(baseUrl, callbackUrl) {
  const seenLinks = new Set();
  let stop = false;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-default-apps',
      '--mute-audio'
    ]
  });

  try {
    for (const location of LOCATIONS) {
      if (stop) break;

      for (const categoryTab of CATEGORY_TABS) {
        if (stop) break;

        const subCategories = CATEGORY_SUBCATEGORIES[categoryTab];

        const tasks = subCategories.map(subCategory =>
          limit(async () => {
            if (stop) return;

            const url = `https://www.district.in/events/${subCategory}-in-${location}-book-tickets`;
            console.log(chalk.yellow(`[INFO] Scraping: ${url}`));

            try {
              const events = await scrapeCategory(
                browser,
                url,
                location,
                categoryTab
              );

              // Global dedupe by eventLink
              const unique = events.filter(e => {
                if (!e.eventLink) return false;
                if (seenLinks.has(e.eventLink)) return false;
                seenLinks.add(e.eventLink);
                return true;
              });

              if (!unique.length) return;

              const slotsLeft = MAX_EVENTS
                ? MAX_EVENTS - seenLinks.size + unique.length
                : unique.length;

              const eventsToSend = MAX_EVENTS
                ? unique.slice(0, slotsLeft)
                : unique;

              if (!eventsToSend.length) return;

              await axios.post(callbackUrl, eventsToSend, {
                timeout: 10_000
              });

              console.log(
                chalk.green(
                  `[✓] ${eventsToSend.length} ${categoryTab} events from ${location}`
                )
              );

              // Stop everything once limit is reached
              if (MAX_EVENTS && seenLinks.size >= MAX_EVENTS) {
                stop = true;
              }

              // Micro cooldown
              await new Promise(r => setTimeout(r, 800));

            } catch (err) {
              console.error(
                chalk.red(
                  `[ERROR] ${categoryTab} | ${location} | ${subCategory} → ${err.message}`
                )
              );
            }
          })
        );

        await Promise.all(tasks);
      }
    }
  } catch (err) {
    console.error(chalk.red(`[FATAL] ${err.message}`));
  } finally {
    await browser.close();
  }
};
