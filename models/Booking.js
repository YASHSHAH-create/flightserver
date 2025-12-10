const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: String }, // From the flight API response
    pnr: { type: String },
    status: { type: String, default: 'Pending' }, // Pending, Confirmed, Failed
    amount: { type: Number },
    flightDetails: { type: Object }, // Store snapshot of flight info
    passengerDetails: { type: Array },
    responseJson: { type: Object }, // Full API response for debugging
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema);
