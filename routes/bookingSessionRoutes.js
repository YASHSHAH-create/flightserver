const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

// Save booking session data and get hash
router.post('/api/save-booking-payload', bookingController.saveBookingData);

// Retrieve booking session data by hash
router.get('/api/get-booking-payload/:hash', bookingController.getBookingData);

// Retrieve booking session data by hash (via POST body)
router.post('/api/retrieve-booking-by-hash', bookingController.retrieveBookingByHash);

module.exports = router;
