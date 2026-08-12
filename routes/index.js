const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const flightRoutes = require('./flightRoutes');
const notificationRoutes = require('./notificationRoutes');

router.use(authRoutes);
router.use(userRoutes);
router.use(flightRoutes);
router.use(notificationRoutes);

router.use(require('./bookingSessionRoutes'));

module.exports = router;
