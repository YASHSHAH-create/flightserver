const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');
const { ensureToken } = require('../middleware/authMiddleware');

// Flight Search Routes
router.get(['/search', '/api/search'], ensureToken, flightController.search);

// Flight Details & Booking Routes
router.post('/flights/fare-rule', ensureToken, flightController.getFareRule);
router.post('/flights/fare-quote', ensureToken, flightController.getFareQuote);
router.post('/flights/ssr', ensureToken, flightController.getSSR);
router.post('/flights/book', ensureToken, flightController.bookFlight);
router.post('/flights/booking-details', ensureToken, flightController.getBookingDetails);

// Calendar Fare Routes
router.post('/flights/calendar-fare', ensureToken, flightController.getCalendarFare);
router.post('/flights/update-calendar-fare', ensureToken, flightController.updateCalendarFareOfDay);

module.exports = router;
