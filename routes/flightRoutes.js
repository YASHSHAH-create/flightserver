const express = require('express');
const router = express.Router();
const flightController = require('../controllers/flightController');
const { ensureToken } = require('../middleware/authMiddleware');
const { requireInternalKey } = require('../middleware/internalAuth');

// Flight Search Routes
router.get(['/search', '/api/search'], ensureToken, flightController.search);

// Flight Details & Booking Routes
router.post('/flights/fare-rule', ensureToken, flightController.getFareRule);
router.post('/flights/fare-quote', ensureToken, flightController.getFareQuote);
router.post('/flights/ssr', ensureToken, flightController.getSSR);
// Ticketing & raw booking-details are internal-only: the payment server calls
// these AFTER verifying capture. requireInternalKey stops direct free-ticket abuse.
router.post('/flights/book', requireInternalKey, ensureToken, flightController.bookFlight);
router.post('/flights/booking-details', requireInternalKey, ensureToken, flightController.getBookingDetails);

// Calendar Fare Routes
router.post('/flights/calendar-fare', ensureToken, flightController.getCalendarFare);
router.post('/flights/update-calendar-fare', ensureToken, flightController.updateCalendarFareOfDay);

module.exports = router;
