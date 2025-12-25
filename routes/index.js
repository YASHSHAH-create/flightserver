const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const flightRoutes = require('./flightRoutes');

router.use(authRoutes);
router.use(userRoutes);
router.use(flightRoutes);

module.exports = router;
