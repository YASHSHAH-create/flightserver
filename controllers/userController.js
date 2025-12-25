const userService = require('../services/userService');

const getBookings = async (req, res) => {
    try {
        let userId;

        // 1. Check if googleId is provided in query
        if (req.query.googleId) {
            const user = await userService.findUserByGoogleId(req.query.googleId);
            if (!user) {
                return res.status(404).json({ error: 'User not found with provided googleId' });
            }
            userId = user._id;
        }
        // 2. Fallback to session user
        else if (req.user) {
            userId = req.user._id;
        }
        // 3. Unauthorized
        else {
            return res.status(401).json({ error: 'Unauthorized: Login or provide googleId' });
        }

        const bookings = await userService.getUserBookings(userId);
        res.json(bookings);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
};

const saveBooking = async (req, res) => {
    try {
        let userId;

        // 1. Check googleId in body
        if (req.body.googleId) {
            const user = await userService.findUserByGoogleId(req.body.googleId);
            if (!user) {
                return res.status(404).json({ error: 'User not found with provided googleId' });
            }
            userId = user._id;
        }
        // 2. Fallback to session user
        else if (req.user) {
            userId = req.user._id;
        }
        // 3. Unauthorized
        else {
            return res.status(401).json({ error: 'Unauthorized: Login or provide googleId' });
        }

        const { bookingId, pnr, status, amount, flightDetails, passengerDetails, responseJson } = req.body;

        const newBooking = await userService.createBooking({
            userId,
            bookingId,
            pnr,
            status: status || 'Pending',
            amount: amount || 0,
            flightDetails,
            passengerDetails,
            responseJson
        });

        res.status(201).json({ success: true, booking: newBooking });
    } catch (error) {
        console.error('Error saving booking:', error);
        res.status(500).json({ error: 'Failed to save booking' });
    }
};

const getBookingDetails = async (req, res) => {
    try {
        let userId;

        // 1. Check if googleId is provided in query
        if (req.query.googleId) {
            const user = await userService.findUserByGoogleId(req.query.googleId);
            if (!user) {
                return res.status(404).json({ error: 'User not found with provided googleId' });
            }
            userId = user._id;
        }
        // 2. Fallback to session user
        else if (req.user) {
            userId = req.user._id;
        }
        // 3. Unauthorized (Optional: depend on if you want public access or not, usually secure)
        // For now, if no user identified, we might still allow if it's just an ID lookup? 
        // But usually bookings are private. Let's enforce auth logic similar to getBookings if possible.
        // If the user didn't specify strict auth on this new API, I will stick to the pattern.

        const bookingId = req.params.id;
        if (!bookingId) {
            return res.status(400).json({ error: 'Booking ID is required' });
        }

        const booking = await userService.getBookingById(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Optional: Check ownership
        if (userId && booking.userId.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized: access to this booking is denied' });
        }

        res.json(booking);
    } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: 'Failed to fetch booking details' });
    }
};

const saveAppBooking = async (req, res) => {
    try {
        const { googleId, orderId, isLCC, TraceId, ResultIndex, Passengers } = req.body;

        if (!googleId || !orderId) {
            return res.status(400).json({ error: 'googleId and orderId are required' });
        }

        // 1. Find User
        const user = await userService.findUserByGoogleId(googleId);
        if (!user) {
            return res.status(404).json({ error: 'User not found with provided googleId' });
        }

        // 2. Calculate Total Amount
        let totalAmount = 0;
        if (Passengers && Array.isArray(Passengers)) {
            Passengers.forEach(p => {
                if (p.Fare) {
                    const fare = p.Fare;
                    totalAmount += (fare.BaseFare || 0) + (fare.Tax || 0) + (fare.YQTax || 0) +
                        (fare.AdditionalTxnFeePub || 0) + (fare.AdditionalTxnFeeOfrd || 0) +
                        (fare.OtherCharges || 0);
                }
            });
        }

        // 3. Construct Flight Details Snapshot
        const flightDetailsSnapshot = {
            isLCC,
            TraceId,
            ResultIndex
        };

        // 4. Save to Database
        const newBooking = await userService.createBooking({
            userId: user._id,
            bookingId: orderId,
            pnr: '', // Not generated yet, usually comes after ticket confirmation
            status: 'Pending',
            amount: totalAmount,
            flightDetails: flightDetailsSnapshot,
            passengerDetails: Passengers,
            responseJson: req.body // Save full request payload for reference
        });

        res.status(201).json({ success: true, message: 'Booking saved successfully', booking: newBooking });

    } catch (error) {
        console.error("Error saving app booking:", error);
        res.status(500).json({ error: 'Failed to save app booking' });
    }
};

module.exports = {
    getBookings,
    saveBooking,
    getBookingDetails,
    saveAppBooking
};
