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

        // --- AUTO-HEALING: Background check for missing rich details ---
        // Fire and forget - don't await this so UI is fast
        (async () => {
            try {
                const tboService = require('../services/tboService');
                const updates = bookings.map(async (b) => {
                    // Condition to trigger update:
                    // 1. Has PNR
                    // 2. Missing displayable city info (likely raw codes) OR missing responseJson OR missing terminal
                    const needsUpdate = b.pnr && (
                        !b.flightInfo?.fromCity ||
                        b.flightInfo.fromCity === b.flightInfo.fromCode ||
                        !b.responseJson?.Response?.FlightItinerary ||
                        !b.flightInfo?.terminal
                    );

                    if (needsUpdate) {
                        console.log(`Auto-sync trigger for booking ${b._id}`);

                        // Determine Payload
                        const tboBookingId = b.responseJson?.Response?.Response?.BookingId ||
                            b.responseJson?.Response?.BookingId ||
                            b.responseJson?.BookingId;
                        const pnr = b.pnr;
                        // Try to get Passenger Last Name if available
                        const leadPax = b.passengerDetails?.find(p => p.IsLeadPax) || b.passengerDetails?.[0];
                        const lastName = leadPax?.LastName || '';

                        let tboPayload = null;
                        if (tboBookingId) {
                            tboPayload = { BookingId: tboBookingId, PNR: pnr };
                        } else if (pnr && lastName) {
                            tboPayload = { PNR: pnr, LastName: lastName };
                        }

                        if (tboPayload) {
                            tboPayload.EndUserIp = process.env.END_USER_IP; // Ensure IP
                            const richDetails = await tboService.getBookingDetails(tboPayload);

                            if (richDetails?.Response?.Error?.ErrorCode === 0 && richDetails?.Response?.FlightItinerary) {
                                const itinerary = richDetails.Response.FlightItinerary;
                                b.responseJson = richDetails;

                                const firstSeg = itinerary.Segments?.[0];
                                if (firstSeg) {
                                    const richFlightInfo = {
                                        ...b.flightInfo,
                                        fromCode: firstSeg.Origin?.Airport?.CityCode || firstSeg.Origin?.Airport?.AirportCode,
                                        toCode: firstSeg.Destination?.Airport?.CityCode || firstSeg.Destination?.Airport?.AirportCode,
                                        fromCity: firstSeg.Origin?.Airport?.CityName,
                                        toCity: firstSeg.Destination?.Airport?.CityName,
                                        airline: firstSeg.Airline?.AirlineName,
                                        flightNumber: `${firstSeg.Airline?.AirlineCode}-${firstSeg.Airline?.FlightNumber}`,
                                        departTime: firstSeg.Origin?.DepTime ? new Date(firstSeg.Origin.DepTime).toLocaleTimeString('short') : b.flightInfo?.departTime,
                                        arriveTime: firstSeg.Destination?.ArrTime ? new Date(firstSeg.Destination.ArrTime).toLocaleTimeString('short') : b.flightInfo?.arriveTime,
                                        date: firstSeg.Origin?.DepTime,
                                        terminal: firstSeg.Origin?.Airport?.Terminal
                                    };
                                    b.flightInfo = richFlightInfo;
                                }
                                await b.save();
                                console.log(`Auto-sync updated booking ${b._id}`);
                            }
                        }
                    }
                });
                // We don't await the map execution here to return response fast, 
                // but we should probably handle promise rejections to avoid unhandled crashes?
                // Promise.allSettled(updates); 
                // Note: Mongoose models might not play nice if 'bookings' are plain objects. 
                // getUserBookings service usually returns database docs.
                await Promise.allSettled(updates);

            } catch (bgError) {
                console.error("Background sync error:", bgError.message);
            }
        })();

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

        // 3. A caller MUST be identified — bookings are private (prevents IDOR by omitting googleId)
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: login or provide googleId' });
        }

        const bookingId = req.params.id;
        if (!bookingId) {
            return res.status(400).json({ error: 'Booking ID is required' });
        }

        const booking = await userService.getBookingById(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Ownership is now enforced unconditionally (userId is guaranteed above)
        if (!booking.userId || booking.userId.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Unauthorized: access to this booking is denied' });
        }

        // --- LAZY LOAD / SELF-HEALING: Check if rich details are missing ---
        // If responseJson.Response.FlightItinerary is missing, try to fetch it from TBO
        if (!booking.responseJson?.Response?.FlightItinerary && (booking.pnr || booking.responseJson?.Response?.Response?.BookingId)) {
            try {
                console.log(`Self-healing booking details for ${booking._id}...`);
                const tboService = require('../services/tboService');

                // Construct Payload
                // Priority: BookingId -> PNR+LastName -> PNR only

                // Helper to safely get numeric BookingId (TBO uses numeric, we use string 'ORDER_...' in bookingId field)
                // We must look inside responseJson for the real TBO BookingId if we saved the initial response
                const tboBookingId = booking.responseJson?.Response?.Response?.BookingId ||
                    booking.responseJson?.Response?.BookingId || // Sometimes structure varies
                    (booking.responseJson?.BookingId);
                 
                const pnr = booking.pnr;
                const leadPax = booking.passengerDetails?.find(p => p.IsLeadPax) || booking.passengerDetails?.[0];
                const lastName = leadPax?.LastName || '';

                let tboPayload = null;

                if (tboBookingId) {
                    tboPayload = {
                        EndUserIp: process.env.END_USER_IP,
                        BookingId: tboBookingId,
                        PNR: pnr
                    };
                } else if (pnr && lastName) {
                    tboPayload = {
                        EndUserIp: process.env.END_USER_IP,
                        PNR: pnr,
                        LastName: lastName
                    };
                } else if (pnr) {
                    tboPayload = {
                        EndUserIp: process.env.END_USER_IP,
                        PNR: pnr,
                        BookingId: 0 // Sometimes 0 triggers PNR search? Request-2 uses both but implies either/or might work
                    };
                    // Actually doc says: "Either BookingId, PNR or TraceId will be required"
                    // But Request 2 passes both. Let's try minimal valid payload.
                    // A safe bet for GetBookingDetails might be PNR + BookingId=0 if unknown?
                }

                if (tboPayload) {
                    const richDetails = await tboService.getBookingDetails(tboPayload);

                    if (richDetails?.Response?.Error?.ErrorCode === 0 && richDetails?.Response?.FlightItinerary) {
                        console.log('Self-healing successful. Updating DB.');
                        const itinerary = richDetails.Response.FlightItinerary;

                        // Update DB Object
                        booking.responseJson = richDetails;
                        // Map key fields to top level flightInfo if missing
                        const firstSeg = itinerary.Segments?.[0];
                        if (firstSeg) {
                            const richFlightInfo = {
                                ...booking.flightInfo,
                                fromCode: firstSeg.Origin?.Airport?.CityCode || firstSeg.Origin?.Airport?.AirportCode,
                                toCode: firstSeg.Destination?.Airport?.CityCode || firstSeg.Destination?.Airport?.AirportCode,
                                fromCity: firstSeg.Origin?.Airport?.CityName,
                                toCity: firstSeg.Destination?.Airport?.CityName,
                                airline: firstSeg.Airline?.AirlineName,
                                flightNumber: `${firstSeg.Airline?.AirlineCode}-${firstSeg.Airline?.FlightNumber}`,
                                // Use original times or new ones if available
                                departTime: firstSeg.Origin?.DepTime ? new Date(firstSeg.Origin.DepTime).toLocaleTimeString('short') : booking.flightInfo?.departTime,
                                arriveTime: firstSeg.Destination?.ArrTime ? new Date(firstSeg.Destination.ArrTime).toLocaleTimeString('short') : booking.flightInfo?.arriveTime,
                                date: firstSeg.Origin?.DepTime
                            };
                            booking.flightInfo = richFlightInfo;
                        }
                        await booking.save();
                    } else {
                        console.log('Self-healing failed (API Error):', richDetails?.Response?.Error?.ErrorMessage);
                    }
                }
            } catch (err) {
                console.error('Self-healing failed (Exception):', err.message);
            }
        }

        res.json(booking);
    } catch (error) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: 'Failed to fetch booking details' });
    }
};

const saveAppBooking = async (req, res) => {
    try {
        const { googleId, orderId, isLCC, TraceId, ResultIndex, Passengers, flightInfo, status, pnr, bookingResponse } = req.body;

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
        let newBooking = await userService.createBooking({
            userId: user._id,
            bookingId: orderId,
            pnr: pnr || '',
            status: status || 'Pending',
            amount: totalAmount,
            flightDetails: flightDetailsSnapshot,
            flightInfo,
            passengerDetails: Passengers,
            responseJson: bookingResponse || req.body // Prefer actual API response if available
        });

        // 5. Attempt to Populate Booking with Rich Data from TBO (GetBookingDetails)
        if (newBooking && (pnr || bookingResponse?.Response?.Response?.BookingId)) {
            try {
                // Determine BookingId from response if not in body
                const supplierBookingId = bookingResponse?.Response?.Response?.BookingId || (newBooking.responseJson?.Response?.Response?.BookingId);
                const supplierPNR = pnr || bookingResponse?.Response?.Response?.PNR;

                if (supplierBookingId || supplierPNR) {
                    const tboPayload = {
                        EndUserIp: process.env.END_USER_IP,
                        BookingId: supplierBookingId,
                        PNR: supplierPNR,
                        TraceId: TraceId
                    };

                    // Import TBO Service here to avoid circular dep if any, or just use require at top if safe
                    const tboService = require('../services/tboService');
                    const richDetails = await tboService.getBookingDetails(tboPayload);

                    if (richDetails?.Response?.Error?.ErrorCode === 0 && richDetails?.Response?.FlightItinerary) {
                        // Update flightInfo with rich details
                        const itinerary = richDetails.Response.FlightItinerary;

                        // Map rich itinerary to our flightInfo structure
                        // Note: Our flightInfo structure used by Frontend expects: 
                        // fromCode, toCode, fromCity, toCity, airline, flightNumber, departTime, arriveTime

                        const firstSeg = itinerary.Segments?.[0];
                        if (firstSeg) {
                            const richFlightInfo = {
                                ...flightInfo, // keep existing as fallback
                                fromCode: firstSeg.Origin?.Airport?.CityCode || firstSeg.Origin?.Airport?.AirportCode,
                                toCode: firstSeg.Destination?.Airport?.CityCode || firstSeg.Destination?.Airport?.AirportCode,
                                fromCity: firstSeg.Origin?.Airport?.CityName,
                                toCity: firstSeg.Destination?.Airport?.CityName,
                                airline: firstSeg.Airline?.AirlineName,
                                flightNumber: `${firstSeg.Airline?.AirlineCode}-${firstSeg.Airline?.FlightNumber}`,
                                departTime: firstSeg.Origin?.DepTime ? new Date(firstSeg.Origin.DepTime).toLocaleTimeString('short') : flightInfo?.departTime,
                                arriveTime: firstSeg.Destination?.ArrTime ? new Date(firstSeg.Destination.ArrTime).toLocaleTimeString('short') : flightInfo?.arriveTime,
                                // Add date for easy display
                                date: firstSeg.Origin?.DepTime,
                                terminal: firstSeg.Origin?.Airport?.Terminal
                            };

                            // Update DB
                            newBooking.flightInfo = richFlightInfo;
                            newBooking.responseJson = richDetails; // Update responseJson to full details
                            await newBooking.save();
                        }
                    }
                }
            } catch (syncError) {
                console.error('Auto-sync with GetBookingDetails failed:', syncError.message);
                // Non-blocking failure, continue
            }
        }

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
