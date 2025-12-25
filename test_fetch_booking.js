require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('./models/Booking');

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');
        const booking = await Booking.findOne();
        if (booking) {
            console.log('Booking ID:', booking._id.toString());
        } else {
            console.log('No bookings found');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();
