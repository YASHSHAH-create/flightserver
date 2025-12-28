const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema({
    Title: { type: String },
    FirstName: { type: String },
    LastName: { type: String },
    PaxType: { type: Number },
    DateOfBirth: { type: Date },
    Gender: { type: Number },
    PassportNo: { type: String },
    PassportExpiry: { type: Date },
    AddressLine1: { type: String },
    City: { type: String },
    CountryCode: { type: String },
    CountryName: { type: String },
    ContactNo: { type: String },
    Email: { type: String },
    Nationality: { type: String },
    IsLeadPax: { type: Boolean },
    Fare: {
        BaseFare: { type: Number },
        Tax: { type: Number },
        YQTax: { type: Number },
        AdditionalTxnFeePub: { type: Number },
        AdditionalTxnFeeOfrd: { type: Number },
        OtherCharges: { type: Number }
    },
    Baggage: [Object],
    MealDynamic: [Object],
    SeatDynamic: [Object],
    GSTCompanyAddress: { type: String },
    GSTCompanyContactNumber: { type: String },
    GSTCompanyName: { type: String },
    GSTNumber: { type: String },
    GSTCompanyEmail: { type: String }
});

const bookingSessionSchema = new mongoose.Schema({
    isLCC: { type: Boolean },
    TraceId: { type: String },
    ResultIndex: { type: String },
    Passengers: [passengerSchema],
    bookingHash: { type: String, unique: true },
    orderId: { type: String },
    googleId: { type: String },
    paymentStatus: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BookingSession', bookingSessionSchema);
