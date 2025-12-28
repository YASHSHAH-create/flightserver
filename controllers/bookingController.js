const BookingSession = require('../models/BookingSession');
const crypto = require('crypto');

const saveBookingData = async (req, res) => {
    try {
        const { isLCC, TraceId, ResultIndex, Passengers, orderId, googleId } = req.body;

        const bookingHash = crypto.randomBytes(32).toString('hex');

        const newBookingSession = new BookingSession({
            isLCC,
            TraceId,
            ResultIndex,
            Passengers,
            bookingHash,
            orderId,
            googleId,
            paymentStatus: 'Pending'
        });

        await newBookingSession.save();

        res.status(201).json({
            message: 'Booking data saved successfully',
            hash: bookingHash
        });
    } catch (error) {
        console.error('Error saving booking data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getBookingData = async (req, res) => {
    try {
        const { hash } = req.params;

        const bookingSession = await BookingSession.findOne({ bookingHash: hash });

        if (!bookingSession) {
            return res.status(404).json({ error: 'Booking session not found' });
        }

        res.status(200).json(bookingSession);
    } catch (error) {
        console.error('Error retrieving booking data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const retrieveBookingByHash = async (req, res) => {
    try {
        const { hash } = req.body;

        if (!hash) {
            return res.status(400).json({ error: 'Hash is required' });
        }

        const bookingSession = await BookingSession.findOne({ bookingHash: hash });

        if (!bookingSession) {
            return res.status(404).json({ error: 'Booking session not found' });
        }

        res.status(200).json(bookingSession);
    } catch (error) {
        console.error('Error retrieving booking data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    saveBookingData,
    getBookingData,
    retrieveBookingByHash
};
