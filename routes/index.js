const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const flightRoutes = require('./flightRoutes');

router.use(authRoutes);
router.use(userRoutes);
router.use(flightRoutes);
router.use(require('./bookingSessionRoutes'));

const axios = require('axios');

// Test API to log payload and forward to bookings API
router.post('/log-payload', async (req, res) => {
    console.log('--- RECEIVED PAYLOAD START ---');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('--- RECEIVED PAYLOAD END ---');

    try {
        const response = await axios.post('http://13.202.144.95:3202/api/bookings', req.body);
        console.log('--- FORWARDED TO BOOKINGS API SUCCESS ---');
        console.log(response.data);
        res.status(200).json({ status: 'success', message: 'Payload logged and forwarded', data: response.data });
    } catch (error) {
        console.error('--- FORWARDED TO BOOKINGS API FAILED ---');
        console.error(error.message);
        if (error.response) {
            console.error(error.response.data);
            res.status(error.response.status).json({ status: 'error', message: 'Forwarding failed', error: error.response.data });
        } else {
            res.status(500).json({ status: 'error', message: 'Forwarding failed', error: error.message });
        }
    }
});

module.exports = router;
