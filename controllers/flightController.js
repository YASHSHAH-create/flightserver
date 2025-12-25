const tboService = require('../services/tboService');
const { formatDate, getClassCode, seatLetterToNumber } = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

const search = async (req, res) => {
    try {
        let { from, to, date, returnDate, adults, children, infants, class: flightClass, journeyType, } = req.query;

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

        const result = await tboService.searchFlights(payload);
        res.json(result);

    } catch (error) {
        console.error('Search API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
};

const getFareRule = async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        const data = await tboService.getFareRule(payload);
        res.json({ success: true, data });

    } catch (error) {
        console.error('Fare Rule API Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
};

const getFareQuote = async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        const data = await tboService.getFareQuote(payload);
        res.json({ success: true, data });

    } catch (error) {
        console.error('Fare Quote API Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
};

const getSSR = async (req, res) => {
    try {
        const { traceId, resultIndex } = req.body;

        if (!traceId || !resultIndex) {
            return res.status(400).json({ error: 'Missing required parameters: traceId, resultIndex' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        const data = await tboService.getSSR(payload);
        res.json({ success: true, data });

    } catch (error) {
        console.error('SSR API Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
};

const bookFlight = async (req, res) => {
    try {
        const {
            isLCC,
            TraceId,
            ResultIndex,
            Passengers,
            IsPriceChangeAccepted
        } = req.body;

        const endUserIp = process.env.END_USER_IP;

        // --- logic for LCC (Direct Ticket) ---
        if (isLCC === true) {
            console.log("Paymm: Initiating LCC Direct Ticket...");

            const lccPayload = {
                PreferredCurrency: null,
                AgentReferenceNo: `PAYMM_${Date.now()}`,
                Passengers,
                EndUserIp: endUserIp,
                TraceId,
                ResultIndex,
                IsPriceChangeAccepted: IsPriceChangeAccepted || false
            };

            const data = await tboService.ticketLCC(lccPayload);

            // Debug: Save LCC Ticket Response
            try {
                fs.writeFileSync(path.join(__dirname, '../response.json'), JSON.stringify({ lccTicketResponse: data }, null, 2));
            } catch (err) { console.error("Error writing response.json", err); }

            return res.status(200).json(data);
        }

        // --- logic for Non-LCC (Hold then Ticket) ---
        else {
            console.log("Paymm: Initiating Non-LCC Step 1 (Hold/Book)...");

            const bookPayload = {
                PreferredCurrency: null,
                Passengers,
                EndUserIp: endUserIp,
                TraceId,
                ResultIndex
            };

            const bookResponse = await tboService.bookNonLCC(bookPayload);

            // Debug: Save Book Response
            let debugData = { bookResponse };
            try {
                fs.writeFileSync(path.join(__dirname, '../response.json'), JSON.stringify(debugData, null, 2));
            } catch (err) { console.error("Error writing response.json (Book)", err); }

            // Check if Book step failed
            if (bookResponse.Response && bookResponse.Response.Error && bookResponse.Response.Error.ErrorCode !== 0) {
                // Special handling for "Book not allowed" error -> Retry as LCC if needed
                if (bookResponse.Response.Error.ErrorCode === 2) {
                    console.log("Paymm: Non-LCC Book rejected. Retrying as Ticket (LCC flow)...");
                    const lccPayload = {
                        PreferredCurrency: null,
                        AgentReferenceNo: `PAYMM_${Date.now()}`,
                        Passengers,
                        EndUserIp: endUserIp,
                        TraceId,
                        ResultIndex,
                        IsPriceChangeAccepted: IsPriceChangeAccepted || false
                    };
                    const retryResponse = await tboService.ticketLCC(lccPayload);

                    // Debug: Save Retry Response
                    debugData.retryTicketResponse = retryResponse;
                    try {
                        fs.writeFileSync(path.join(__dirname, '../response.json'), JSON.stringify(debugData, null, 2));
                    } catch (err) { console.error("Error writing response.json (Retry)", err); }

                    return res.status(200).json(retryResponse);
                }

                console.error("Paymm: Non-LCC Book Step Failed", JSON.stringify(bookResponse));
                return res.status(400).json(bookResponse);
            }

            // If success, get PNR and BookingId for Ticketing
            // bookResponse.Response.Response is the actual BookingDetails object (Review TBO Structure)
            // Structure: bookResponse.Response (Response Wrapper) -> .Response (Main Body) -> .PNR / .BookingId
            const bookingMainResponse = bookResponse.Response?.Response;

            if (!bookingMainResponse) {
                console.error("Paymm: Invalid Book Response Structure (No Response.Response)", JSON.stringify(bookResponse));
                return res.status(500).json({ error: 'Invalid Book Response from Supplier' });
            }

            const pnr = bookingMainResponse.PNR;
            const bookingId = bookingMainResponse.BookingId;

            console.log(`Paymm: Non-LCC Hold Success. PNR: ${pnr}, BookingId: ${bookingId}`);

            // Step 2: Prepare Ticket Payload with PaxId from Book Response
            // We need to map the Passenger details (Passport info) AND the PaxId returned from the Book Response.

            // Extract Passengers from Book Response to get PaxIds
            // Typically: bookingMainResponse.FlightItinerary.Passenger[] or just bookingMainResponse.Passenger[]
            // Based on User json snippet: "Passport": [ { "PaxId": 2040529, ... } ]

            // Let's look for Passenger list in Book Response
            // The structure often is: bookingMainResponse.FlightItinerary?.Passenger or bookingMainResponse.Passenger
            // We will try to find the relevant Passengers to map PaxId.
            // Assumption: The order of Passengers in Request matches Response, or we match by Name?
            // Safer to assume Order matches or try to match logic.
            // For now, let's map by index if possible, or just extract logic.

            // ACTUALLY: The user's Ticket Request sample shows "Passport" array.
            // "Passport": [ { PaxId, PassportNo, PassportExpiry, DateOfBirth }, ... ]

            const bookedPassengers = bookingMainResponse.FlightItinerary?.Passenger || [];

            if (bookedPassengers.length === 0) {
                console.warn("Paymm: No passengers found in Book Response to map PaxIds. Proceeding without mapped PaxIds (Risk of Error).");
            }

            const passportPayload = Passengers.map((pax, index) => {
                // Find corresponding booked pax to get PaxId
                // We'll assume index matching for now as most APIs preserve order.
                const bookedPax = bookedPassengers[index];

                return {
                    PaxId: bookedPax?.PaxId, // This is CRITICAL for "Invalid PaxId" error
                    PassportNo: pax.PassportNo || "", // Optional
                    PassportExpiry: pax.PassportExpiry || "", // Optional
                    DateOfBirth: pax.DateOfBirth, // Mandatory
                };
            });

            console.log("Paymm: Initiating Non-LCC Step 2 (Ticket)...");

            const ticketPayload = {
                EndUserIp: endUserIp,
                TraceId,
                PNR: pnr,
                BookingId: bookingId,
                Passport: passportPayload,
                IsPriceChangeAccepted: IsPriceChangeAccepted || false
            };

            const ticketResponse = await tboService.ticketNonLCC(ticketPayload);

            // Debug: Save Ticket Response
            debugData.ticketResponse = ticketResponse;
            try {
                fs.writeFileSync(path.join(__dirname, '../response.json'), JSON.stringify(debugData, null, 2));
            } catch (err) { console.error("Error writing response.json (Ticket)", err); }

            return res.status(200).json(ticketResponse);
        }

    } catch (error) {
        console.error('Booking Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
};

module.exports = {
    search,
    getFareRule,
    getFareQuote,
    getSSR,
    bookFlight
};
