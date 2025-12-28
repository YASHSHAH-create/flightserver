const express = require('express');
const router = express.Router();
const axios = require('axios');

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const flightRoutes = require('./flightRoutes');

router.use(authRoutes);
router.use(userRoutes);
router.use(flightRoutes);
router.use(require('./bookingSessionRoutes'));

// Test API to log payload and forward it
router.post('/log-payload', async (req, res) => {
    console.log('--- RECEIVED PAYLOAD START ---');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('--- RECEIVED PAYLOAD END ---');

    try {
        const response = await axios.post('https://f6dc03d185fa.ngrok-free.app/log-payload', req.body, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Payload forwarded successfully:', response.status);
        res.status(200).json({ status: 'success', message: 'Payload logged and forwarded', data: req.body, forwardedResponse: response.data });
    } catch (error) {
        console.error('Error forwarding payload:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed to forward payload', error: error.message });
    }
});

module.exports = router;
