const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const scrapeCategory = require('./scrapeCategory');

puppeteer.use(StealthPlugin());

const LOCATIONS = ['mumbai'];
const CATEGORY_TABS = ['Activities','Events'];
const SUB_CATEGORY_EVENT_LIST = ['music', 'comedy', 'nightlife'];
const SUB_CATEGORY_ACTIVITY_LIST = ['theme-parks', 'water-parks', 'adventure'];

const CATEGORY_SUBCATEGORIES = {
    Events: SUB_CATEGORY_EVENT_LIST,
    Activities: SUB_CATEGORY_ACTIVITY_LIST,
};


module.exports = async function mainScraper(baseUrl) {
    const allEvents = [];

    for (const location of LOCATIONS) {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        for (const categoryTab of CATEGORY_TABS) {
            const subCategories = CATEGORY_SUBCATEGORIES[categoryTab];

            for (const subCategory of subCategories) {
                const url = `https://www.district.in/events/${subCategory.toLowerCase()}-in-${location}-book-tickets`;
                console.log(chalk.yellow(`[INFO] Scraping: ${url}`));

                try {
                    const events = await scrapeCategory(browser, url, location, categoryTab);
                    console.log(chalk.green(`[✓] ${events.length} from ${categoryTab} in ${location}`));
                    allEvents.push(...events);
                } catch (err) {
                    console.error(chalk.red(`[ERROR] ${categoryTab} in ${location}: ${err.message}`));
                }
            }
        }

        await browser.close();
    }

    return allEvents;
};