const User = require('../models/User');
const Booking = require('../models/Booking');

const findUserByGoogleId = async (googleId) => {
    // Coerce to string to block NoSQL operator injection (e.g. ?googleId[$ne]=null)
    if (googleId === undefined || googleId === null) return null;
    return await User.findOne({ googleId: String(googleId) });
};

const findUserById = async (id) => {
    return await User.findById(id);
};

const getUserBookings = async (userId) => {
    return await Booking.find({ userId }).sort({ createdAt: -1 });
};

const createBooking = async (bookingData) => {
    return await Booking.create(bookingData);
};

const getBookingById = async (bookingId) => {
    return await Booking.findById(bookingId);
};

module.exports = {
    findUserByGoogleId,
    findUserById,
    getUserBookings,
    createBooking,
    getBookingById
};
