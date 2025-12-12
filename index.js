require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const User = require('./models/User');
const Booking = require('./models/Booking');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/flight-app')
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/flight-app' }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Passport Config
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback", // Make sure this matches Google Cloud Console
    proxy: true
},
    async function (accessToken, refreshToken, profile, cb) {
        try {
            let user = await User.findOne({ googleId: profile.id });
            if (!user) {
                user = await User.create({
                    googleId: profile.id,
                    email: profile.emails[0].value,
                    name: profile.displayName,
                    picture: profile.photos?.[0]?.value
                });
            }
            return cb(null, user);
        } catch (err) {
            return cb(err, null);
        }
    }));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

app.use(passport.initialize());
app.use(passport.session());


// Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login-failed' }),
    function (req, res) {
        res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
    }
);

app.get('/api/auth/user', (req, res) => {
    res.json(req.user || null);
});

app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) { return res.status(500).json({ error: 'Logout failed' }); }
        res.json({ message: 'Logged out' });
    });
});

// User Booking History (Get)
app.get('/api/user/bookings', async (req, res) => {
    try {
        let userId;

        // 1. Check if googleId is provided in query
        if (req.query.googleId) {
            const user = await User.findOne({ googleId: req.query.googleId });
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

        const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });
        res.json(bookings);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// User Booking History (Manual Save)
// User Booking History (Manual Save)
app.post('/api/user/bookings', async (req, res) => {
    try {
        let userId;

        // 1. Check googleId in body
        if (req.body.googleId) {
            const user = await User.findOne({ googleId: req.body.googleId });
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

        const { bookingId, pnr, status, amount, flightDetails, responseJson } = req.body;

        const newBooking = await Booking.create({
            userId,
            bookingId,
            pnr,
            status: status || 'Pending',
            amount: amount || 0,
            flightDetails,
            responseJson
        });

        res.status(201).json({ success: true, booking: newBooking });
    } catch (error) {
        console.error('Error saving booking:', error);
        res.status(500).json({ error: 'Failed to save booking' });
    }
});

// Global Request Logger
app.use((req, res, next) => {
    console.log(`[Global Logger] ${req.method} ${req.url} at ${new Date().toISOString()}`);
    next();
});

let tokenId = null;

// Function to authenticate and get TokenId
const authenticate = async () => {
    try {
        const response = await axios.post(process.env.AUTH_API_URL, {
            ClientId: process.env.CLIENT_ID,
            UserName: process.env.USERNAME,
            Password: process.env.PASSWORD,
            EndUserIp: process.env.END_USER_IP
        });

        if (response.data && response.data.TokenId) {
            tokenId = response.data.TokenId;
            console.log('Authentication successful. TokenId:', tokenId);
        } else {
            console.error('Authentication failed:', response.data);
        }
    } catch (error) {
        console.error('Error during authentication:', error.message);
    }
};

// Middleware to ensure we have a token
const ensureToken = async (req, res, next) => {
    if (!tokenId) {
        await authenticate();
    }
    if (!tokenId) {
        return res.status(500).json({ error: 'Failed to authenticate with flight API' });
    }
    next();
};

// Helper to format date from DDMMYYYY to YYYY-MM-DDT00:00:00
const formatDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return null;
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    return `${year}-${month}-${day}T00:00:00`;
};

// Helper to map class to FlightCabinClass integer
const getClassCode = (classStr) => {
    const map = {
        'e': 2, // Economy
        'pe': 3, // PremiumEconomy
        'b': 4, // Business
        'pb': 5, // PremiumBusiness
        'f': 6  // First
    };
    return map[classStr?.toLowerCase()] || 1; // Default to 1 (All)
};

app.get(['/api/search', '/search'], ensureToken, async (req, res) => {
    try {

        let { from, to, date, returnDate, adults, children, infants, class: flightClass, journeyType } = req.query;

        // Sanitize inputs for OneWay/Return to handle duplicate query params
        const getSingleValue = (val) => Array.isArray(val) ? val[0] : val;

        if (parseInt(journeyType) !== 3) {
            from = getSingleValue(from);
            to = getSingleValue(to);
            date = getSingleValue(date);
            returnDate = getSingleValue(returnDate);
        }

        // Basic validation for required fields (first segment)
        if (!from || !to || !date) {
            return res.status(400).json({ error: 'Missing required parameters: from, to, date' });
        }

        const type = parseInt(journeyType) || 1; // 1: OneWay, 2: Return, 3: MultiCity
        let segments = [];
        const cabinClass = getClassCode(flightClass);

        if (type === 3) {
            // Multicity: Expect arrays for from, to, date
            const fromArr = Array.isArray(from) ? from : [from];
            const toArr = Array.isArray(to) ? to : [to];
            const dateArr = Array.isArray(date) ? date : [date];

            // Filter out any undefined/empty entries if lengths mismatch, or just iterate based on shortest
            const minLen = Math.min(fromArr.length, toArr.length, dateArr.length);

            for (let i = 0; i < minLen; i++) {
                const fDate = formatDate(dateArr[i]);
                if (!fDate) continue; // Skip invalid dates

                segments.push({
                    Origin: fromArr[i],
                    Destination: toArr[i],
                    FlightCabinClass: cabinClass,
                    PreferredDepartureTime: fDate,
                    PreferredArrivalTime: fDate
                });
            }

            if (segments.length === 0) {
                return res.status(400).json({ error: 'Invalid segments data for Multicity search' });
            }

        } else if (type === 2) {
            // Return: Two segments
            const fDate1 = formatDate(date);
            const fDate2 = formatDate(returnDate);

            if (!fDate1 || !fDate2) {
                return res.status(400).json({ error: 'Invalid date format. Use DDMMYYYY. Return search requires returnDate.' });
            }

            // Segment 1: Onward
            segments.push({
                Origin: from,
                Destination: to,
                FlightCabinClass: cabinClass,
                PreferredDepartureTime: fDate1,
                PreferredArrivalTime: fDate1
            });

            // Segment 2: Return
            segments.push({
                Origin: to,
                Destination: from,
                FlightCabinClass: cabinClass,
                PreferredDepartureTime: fDate2,
                PreferredArrivalTime: fDate2
            });

        } else {
            // OneWay (Default)
            const fDate = formatDate(date);
            if (!fDate) {
                return res.status(400).json({ error: 'Invalid date format. Use DDMMYYYY' });
            }

            segments.push({
                Origin: from,
                Destination: to,
                FlightCabinClass: cabinClass,
                PreferredDepartureTime: fDate,
                PreferredArrivalTime: fDate
            });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId,
            AdultCount: parseInt(adults) || 1,
            ChildCount: parseInt(children) || 0,
            InfantCount: parseInt(infants) || 0,
            DirectFlight: false,
            OneStopFlight: false,
            JourneyType: type,
            PreferredAirlines: null,
            Segments: segments,
            Sources: null
        };

        console.log('Sending search request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.SEARCH_API_URL, payload);

        // Check for specific error codes that might indicate token expiry
        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            // If token is invalid, maybe retry once? For now just return the error.
            // If the error is related to session expiry, we could clear tokenId and retry.
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.SEARCH_API_URL, payload);
                return res.json(retryResponse.data);
            }
        }

        res.json(response.data);

    } catch (error) {
        console.error('Search API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

// Fare Rule API endpoint
app.post('/flights/fare-rule', ensureToken, async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        console.log('Sending fare rule request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.FARE_RULE_API_URL, payload);

        // Handle token expiry
        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.FARE_RULE_API_URL, payload);
                const responseData = retryResponse.data.Response || retryResponse.data;
                return res.json({ success: true, data: responseData });
            }
        }

        const responseData = response.data.Response || response.data;
        res.json({ success: true, data: responseData });

    } catch (error) {
        console.error('Fare Rule API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
});

// Fare Quote API endpoint
app.post('/flights/fare-quote', ensureToken, async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        console.log('Sending fare quote request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.FARE_QUOTE_API_URL, payload);

        // Handle token expiry
        if (response.data && response.data.Response && response.data.Response.Error && response.data.Response.Error.ErrorCode !== 0) {
            if (response.data.Response.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.FARE_QUOTE_API_URL, payload);
                const responseData = retryResponse.data.Response || retryResponse.data;
                return res.json({ success: true, data: responseData });
            }
        }

        const responseData = response.data.Response || response.data;
        res.json({ success: true, data: responseData });

    } catch (error) {
        console.error('Fare Quote API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
});

// SSR (Seat Map) API endpoint
app.post('/flights/ssr', ensureToken, async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        console.log('Sending SSR request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.SSR_API_URL, payload);

        // Handle token expiry
        if (response.data && response.data.Response && response.data.Response.Error && response.data.Response.Error.ErrorCode !== 0) {
            if (response.data.Response.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.SSR_API_URL, payload);
                const processedData = processSSRResponse(retryResponse.data.Response);
                return res.json({ success: true, data: processedData });
            }
        }

        const processedData = processSSRResponse(response.data.Response || response.data);
        res.json({ success: true, data: processedData });

    } catch (error) {
        console.error('SSR API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
});

// Helper function to process SSR response
const processSSRResponse = (response) => {
    if (!response || !response.SeatDynamic) {
        return response;
    }

    const processedResponse = {
        ...response,
        SeatDynamic: response.SeatDynamic.map(segment => ({
            SegmentSeat: segment.SegmentSeat?.map(segmentSeat => ({
                RowSeats: processRowSeats(segmentSeat.RowSeats)
            }))
        }))
    };

    return processedResponse;
};

// Helper function to process row seats
const processRowSeats = (rowSeats) => {
    if (!rowSeats || rowSeats.length === 0) return rowSeats;

    // Find the maximum number of seats in any row
    const maxSeatsInRow = Math.max(...rowSeats.map(row => row.Seats?.length || 0));

    // Get the reference row (row with max seats)
    const referenceRow = rowSeats.find(row => row.Seats?.length === maxSeatsInRow);

    if (!referenceRow) return rowSeats;

    // Process each row
    return rowSeats.map(row => {
        if (!row.Seats || row.Seats.length === 0) return row;

        // If this row has fewer seats than the max, insert "NoSeat" placeholders
        if (row.Seats.length < maxSeatsInRow) {
            const processedSeats = [];
            let currentSeatIndex = 0;

            for (let i = 0; i < referenceRow.Seats.length; i++) {
                const refSeat = referenceRow.Seats[i];
                const currentSeat = row.Seats[currentSeatIndex];

                // Check if seat positions match
                if (currentSeat && currentSeat.SeatNo === refSeat.SeatNo) {
                    processedSeats.push(enhanceSeatInfo(currentSeat));
                    currentSeatIndex++;
                } else {
                    // Insert placeholder
                    processedSeats.push({
                        Code: "NoSeat",
                        SeatType: getSeatTypeEnum(refSeat.SeatType),
                        SeatNo: refSeat.SeatNo,
                        AvailablityType: 0,
                        Price: 0
                    });
                }
            }

            return { Seats: processedSeats };
        }

        // Process seats normally
        return {
            Seats: row.Seats.map(seat => enhanceSeatInfo(seat))
        };
    });
};

// Helper function to enhance seat info with enums
const enhanceSeatInfo = (seat) => {
    return {
        ...seat,
        SeatTypeEnum: getSeatTypeEnum(seat.SeatType),
        AvailabilityTypeEnum: getAvailabilityTypeEnum(seat.AvailablityType),
        DeckEnum: getDeckEnum(seat.Deck),
        CompartmentEnum: getCompartmentEnum(seat.Compartment),
        SeatWayTypeEnum: getWayTypeEnum(seat.SeatWayType)
    };
};

// Enum helper functions
const getSeatTypeEnum = (type) => {
    const seatTypes = {
        0: 'NotSet', 1: 'Window', 2: 'Aisle', 3: 'Middle',
        4: 'WindowRecline', 5: 'WindowWing', 6: 'WindowExitRow',
        7: 'WindowReclineWing', 8: 'WindowReclineExitRow', 9: 'WindowWingExitRow',
        10: 'AisleRecline', 11: 'AisleWing', 12: 'AisleExitRow',
        13: 'AisleReclineWing', 14: 'AisleReclineExitRow', 15: 'AisleWingExitRow',
        16: 'MiddleRecline', 17: 'MiddleWing', 18: 'MiddleExitRow',
        19: 'MiddleReclineWing', 20: 'MiddleReclineExitRow', 21: 'MiddleWingExitRow',
        22: 'WindowReclineWingExitRow', 23: 'AisleReclineWingExitRow', 24: 'MiddleReclineWingExitRow',
        25: 'WindowBulkhead', 26: 'WindowQuiet', 27: 'WindowBulkheadQuiet',
        28: 'MiddleBulkhead', 29: 'MiddleQuiet', 30: 'MiddleBulkheadQuiet',
        31: 'AisleBulkhead', 32: 'AisleQuiet', 33: 'AisleBulkheadQuiet'
    };
    return seatTypes[type] || 'NotSet';
};

const getAvailabilityTypeEnum = (type) => {
    const types = {
        0: 'NotSet', 1: 'Open', 2: 'CheckedIn', 3: 'Reserved', 4: 'FleetBlocked'
    };
    return types[type] || 'NotSet';
};

const getDeckEnum = (deck) => {
    const decks = { 0: 'NotSet', 1: 'Deck1', 2: 'Deck2', 3: 'Deck3' };
    return decks[deck] || 'NotSet';
};

const getCompartmentEnum = (compartment) => {
    const compartments = {
        0: 'NotSet', 1: 'Compartment1', 2: 'Compartment2', 3: 'Compartment3',
        4: 'Compartment4', 5: 'Compartment5', 6: 'Compartment6', 7: 'Compartment7'
    };
    return compartments[compartment] || 'NotSet';
};

const getWayTypeEnum = (type) => {
    const types = { 0: 'NotSet', 1: 'Segment', 2: 'FullJourney' };
    return types[type] || 'NotSet';
};

// Helper function to convert seat letter to number
const seatLetterToNumber = (letter) => {
    const map = {
        'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6,
        'G': 7, 'H': 8, 'I': 9, 'J': 10, 'K': 11, 'L': 12,
        'M': 13, 'N': 14
    };
    return map[letter?.toUpperCase()] || 0;
};
// Book API endpoint
app.post('/flights/book', ensureToken, async (req, res) => {
    console.log('-------------------------------------------');
    console.log('Book API Endpoint Hit at', new Date().toISOString());
    console.log('Incoming Request Body:', JSON.stringify(req.body, null, 2));
    console.log('-------------------------------------------');
    try {
        const payload = {
            ...req.body,
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId
        };

        console.log('Sending book request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.BOOK_API_URL, payload);

        // Check for specific error codes that might indicate token expiry
        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            console.error('Book API returned error:', JSON.stringify(response.data.Error, null, 2));
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.BOOK_API_URL, payload);

                // Save to DB on Retry Success
                if (retryResponse.data && retryResponse.data.Response && retryResponse.data.Response.Error.ErrorCode === 0 && req.user) {
                    try {
                        await Booking.create({
                            userId: req.user._id,
                            bookingId: retryResponse.data.Response.Response?.BookingId,
                            pnr: retryResponse.data.Response.Response?.PNR,
                            status: 'Confirmed', // Assume confirmed if no error
                            amount: 0, // Need to extract amount from somewhere if available
                            flightDetails: payload, // Saving request as details for now
                            responseJson: retryResponse.data
                        });
                    } catch (dbErr) {
                        console.error("Failed to save booking to DB", dbErr);
                    }
                }
                return res.json(retryResponse.data);
            }
        }

        // Save to DB on Success
        if (response.data && response.data.Response && response.data.Response.Error.ErrorCode === 0 && req.user) {
            try {
                await Booking.create({
                    userId: req.user._id,
                    bookingId: response.data.Response.Response?.BookingId,
                    pnr: response.data.Response.Response?.PNR,
                    status: 'Confirmed',
                    amount: 0,
                    flightDetails: payload,
                    responseJson: response.data
                });
            } catch (dbErr) {
                console.error("Failed to save booking to DB", dbErr);
            }
        }

        res.json(response.data);

    } catch (error) {
        console.error('Book API Error:', error.message);
        if (error.response) {
            console.error('Book API Response Status:', error.response.status);
            console.error('Book API Response Data:', JSON.stringify(error.response.data, null, 2));
            res.status(error.response.status).json(error.response.data);
        } else {
            console.error('Full Error Object:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
});

// Ticket API endpoint
app.post('/flights/ticket', ensureToken, async (req, res) => {
    try {
        const payload = {
            ...req.body,
            EndUserIp: process.env.END_USER_IP,
            TokenId: tokenId
        };

        console.log('Sending ticket request:', JSON.stringify(payload, null, 2));

        const response = await axios.post(process.env.TICKET_API_URL, payload);

        // Handle token expiry
        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            console.error('Ticket API returned error:', JSON.stringify(response.data.Error, null, 2));
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.TICKET_API_URL, payload);
                return res.json(retryResponse.data);
            }
        }

        res.json(response.data);

    } catch (error) {
        console.error('Ticket API Error:', error.message);
        if (error.response) {
            console.error('Ticket API Response Status:', error.response.status);
            console.error('Ticket API Response Data:', JSON.stringify(error.response.data, null, 2));
            res.status(error.response.status).json(error.response.data);
        } else {
            console.error('Full Error Object:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
});

app.get('/health', (req, res) => {
    res.json({ message: 'Server is running' });
})




app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await authenticate();
});

// Debug: Keep process alive
setInterval(() => {
    // console.log('Heartbeat');
}, 60000);

