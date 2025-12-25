const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// User Routes
// This route uses "appbooking" as requested by user, mounted at root level effectively if these are user routes
router.post('/appbooking', userController.saveAppBooking);
router.get('/api/user/bookings', userController.getBookings);
router.get('/api/user/bookings/:id', userController.getBookingDetails);
router.post('/api/user/bookings', userController.saveBooking);

module.exports = router;
