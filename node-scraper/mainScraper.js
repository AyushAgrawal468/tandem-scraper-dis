const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chalk = require('chalk');
const scrapeCategory = require('./scrapeCategory');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const LOCATIONS = ['indore','mumbai','new-delhi','bangalore','hyderabad','chennai','pune','kolkata','ahmedabad','jaipur','gurgaon','noida','chandigarh'];
const CATEGORY_TABS = ['Activities','Events'];
const SUB_CATEGORY_EVENT_LIST = ['music', 'comedy', 'nightlife','performances','sports','food-drinks','fests-fairs','social-mixers','screenings','fitness','conferences','expos','art-exhibitions'];
const SUB_CATEGORY_ACTIVITY_LIST = ['theme-parks', 'water-parks', 'adventure','game-zones','kids-play','workshops','games-quizzes','art-craft','fitness','pets','esports','museums'];

const CATEGORY_SUBCATEGORIES = {
    Events: SUB_CATEGORY_EVENT_LIST,
    Activities: SUB_CATEGORY_ACTIVITY_LIST,
};


module.exports = async function mainScraper(baseUrl,callbackUrl) {
    const allEvents = [];
    
    // 🧪 TESTING ONLY: Limit total events to 10 for faster testing
    // TODO: Remove this limit for production scraping
    const maxEvents = 1000; // Set to null or remove this line for unlimited scraping
    const browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

    outerLoop: for (const location of LOCATIONS) {
       
        for (const categoryTab of CATEGORY_TABS) {
            const subCategories = CATEGORY_SUBCATEGORIES[categoryTab];

            for (const subCategory of subCategories) {
                // 🧪 TESTING ONLY: Stop when we reach the test limit
                if (maxEvents && allEvents.length >= maxEvents) {
                    console.log(chalk.blue(`[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`));
                    await browser.close();
                    break outerLoop;
                }

                const url = `https://www.district.in/events/${subCategory.toLowerCase()}-in-${location}-book-tickets`;
                console.log(chalk.yellow(`[INFO] Scraping: ${url}`));

                try {
                    const events = await scrapeCategory(browser, url, location, categoryTab);
                    // 🧪 TESTING ONLY: Limit events added to stay within test limit
                    const eventsToAdd = maxEvents ? events.slice(0, maxEvents - allEvents.length) : events;
                    console.log(chalk.green(`[✓] ${eventsToAdd.length} from ${categoryTab} in ${location}`));
                    allEvents.push(...eventsToAdd);
                    
                    console.log("callbackUrl: "+callbackUrl);


                    await axios.post(callbackUrl, eventsToAdd);

                    // 🧪 TESTING ONLY: Check if we've reached the test limit
                    if (maxEvents && allEvents.length >= maxEvents) {
                        console.log(chalk.blue(`[INFO] Reached test limit of ${maxEvents} events. Stopping scraping.`));
                        await browser.close();
                        break outerLoop;
                    }
                    
                } catch (err) {
                    console.error(chalk.red(`[ERROR] ${categoryTab} in ${location}: ${err.message}`));
                }
            }            
        }

       
    }
    await browser.close();  
    return allEvents;
};