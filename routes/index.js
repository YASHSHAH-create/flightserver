const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const flightRoutes = require('./flightRoutes');

router.use(authRoutes);
router.use(userRoutes);
router.use(flightRoutes);
router.use(require('./bookingSessionRoutes'));

// Test API to log payload
router.post('/log-payload', (req, res) => {
    console.log('--- RECEIVED PAYLOAD START ---');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('--- RECEIVED PAYLOAD END ---');
    res.status(200).json({ status: 'success', message: 'Payload logged', data: req.body });
});

module.exports = router;
