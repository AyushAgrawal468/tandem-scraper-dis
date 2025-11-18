const express = require('express');
const router = express.Router();
const mainScraper = require('../scraper/mainScraper');

router.post('/', async (req, res) => {
    const { baseUrl, callbackUrl } = req.body;

    if (!baseUrl) {
        return res.status(400).json({ error: 'Missing baseUrl' });
    }

    if (!callbackUrl) {
        return res.status(400).json({ error: 'Missing callbackUrl' });
    }

    try {
        const allEvents = await mainScraper(baseUrl, callbackUrl);
        res.json(allEvents);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
