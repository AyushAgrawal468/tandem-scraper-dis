const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const scrapeCategory = require('./scrapeCategory');
const axios = require('axios');
const pLimit = require('p-limit');

puppeteer.use(StealthPlugin());

const LOCATIONS = [
  'indore', 'mumbai', 'new-delhi', 'bangalore', 'hyderabad',
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
  'theme-parks', 'water-parks', 'adventure', 'game-zones',
  'kids-play', 'workshops', 'games-quizzes', 'art-craft',
  'fitness', 'pets', 'esports', 'museums'
];

const CATEGORY_SUBCATEGORIES = {
  Events: SUB_CATEGORY_EVENT_LIST,
  Activities: SUB_CATEGORY_ACTIVITY_LIST
};

// 🔒 Max parallel pages (CRITICAL for CPU control)
const limit = pLimit(2);

// 🧪 Safety limit (remove or raise for full production)
const MAX_EVENTS = 1000;

module.exports = async function mainScraper(baseUrl, callbackUrl) {
  const allEvents = [];

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
      for (const categoryTab of CATEGORY_TABS) {
        const subCategories = CATEGORY_SUBCATEGORIES[categoryTab];

        const tasks = subCategories.map(subCategory =>
          limit(async () => {
            if (MAX_EVENTS && allEvents.length >= MAX_EVENTS) return;

            const url = `https://www.district.in/events/${subCategory}-in-${location}-book-tickets`;
            console.log(chalk.yellow(`[INFO] Scraping: ${url}`));

            try {
              const events = await scrapeCategory(
                browser,
                url,
                location,
                categoryTab
              );

              const remaining = MAX_EVENTS
                ? MAX_EVENTS - allEvents.length
                : events.length;

              const eventsToAdd = MAX_EVENTS
                ? events.slice(0, remaining)
                : events;

              if (!eventsToAdd.length) return;

              allEvents.push(...eventsToAdd);

              await axios.post(callbackUrl, eventsToAdd, {
                timeout: 10_000
              });

              console.log(
                chalk.green(
                  `[✓] ${eventsToAdd.length} ${categoryTab} events from ${location}`
                )
              );

              // 🧊 Cooldown to reduce sustained CPU pressure
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

  return allEvents;
};
