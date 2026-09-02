const tboService = require('../services/tboService');
const { formatDate, getClassCode, seatLetterToNumber, sendTelegramNotification } = require('../utils/helpers');
const { transformFareQuote } = require('../utils/tboTransformer');
const roundTrip = require('../utils/roundTrip');
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

            // A return before the onward date is never valid — reject clearly
            // instead of letting TBO fail with an opaque supplier error.
            if (new Date(fDate2) < new Date(fDate1)) {
                return res.status(400).json({ error: 'Return date cannot be before the departure date.' });
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

        // Domestic return: "IDX1,IDX2" — TBO must be quoted per leg
        if (roundTrip.isCombinedIndex(resultIndex)) {
            const indexes = roundTrip.splitResultIndexes(resultIndex);
            if (indexes.length !== 2) {
                return res.status(400).json({ success: false, error: 'A return fare quote needs exactly two result indexes.' });
            }

            const rawLegs = [];
            for (const idx of indexes) {
                const legData = await tboService.getFareQuote({
                    EndUserIp: process.env.END_USER_IP,
                    TraceId: traceId,
                    ResultIndex: idx
                });
                const legError = legData && legData.Error && legData.Error.ErrorCode !== 0;
                if (legError || !legData || !legData.Results) {
                    // Surface the failing leg raw — the app already understands
                    // TBO error shapes (session expiry etc.)
                    return res.json({ success: false, data: legData });
                }
                rawLegs.push(legData);
            }

            try {
                const clean1 = transformFareQuote(rawLegs[0]);
                const clean2 = transformFareQuote(rawLegs[1]);
                const combined = roundTrip.combineCleanQuotes(clean1, clean2);
                if (rawLegs.some(l => l.IsPriceChanged)) combined.IsPriceChanged = true;
                combined.legs = rawLegs.map((l, i) => ({
                    resultIndex: indexes[i],
                    isLCC: l.Results?.IsLCC === true || l.Results?.IsLCC === 'true',
                    fare: l.Results?.Fare || null,
                }));
                return res.json({ success: true, data: combined, rawTboResponse: { Legs: rawLegs } });
            } catch (transformError) {
                console.error('Round-trip quote transform error:', transformError.message);
                return res.json({ success: false, data: { Error: { ErrorCode: 100, ErrorMessage: 'Could not combine return fare quote.' } } });
            }
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            TraceId: traceId,
            ResultIndex: resultIndex
        };

        const data = await tboService.getFareQuote(payload);

        // Check for business error in response
        const hasError = data.Error && data.Error.ErrorCode !== 0;

        if (!hasError && data.Results) {
            try {
                // Apply the transformer to get clean UI-friendly format
                const cleanData = transformFareQuote(data);
                return res.json({ 
                    success: true, 
                    data: cleanData,
                    rawTboResponse: data
                });
            } catch (transformError) {
                console.error("Transformer error:", transformError.message);
                // Fallback to raw data if transformation fails
            }
        }

        res.json({ success: !hasError, data });

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

        // Domestic return: fetch SSR per leg and merge the per-segment arrays —
        // the add-ons screen derives its segment tabs from these arrays, so a
        // plain concat gives it onward + return segments in order.
        if (roundTrip.isCombinedIndex(resultIndex)) {
            const indexes = roundTrip.splitResultIndexes(resultIndex);
            const merged = { Error: { ErrorCode: 0, ErrorMessage: '' } };
            const arrayKeys = ['Baggage', 'MealDynamic', 'Meal', 'SeatDynamic', 'SeatPreference', 'SpecialServices'];

            for (const idx of indexes) {
                const legData = await tboService.getSSR({
                    EndUserIp: process.env.END_USER_IP,
                    TraceId: traceId,
                    ResultIndex: idx
                });
                if (legData && legData.Error && legData.Error.ErrorCode !== 0) {
                    // SSR is optional — a failing leg just means no add-ons for it
                    console.warn(`SSR failed for leg ${idx}: ${legData.Error.ErrorMessage}`);
                    continue;
                }
                arrayKeys.forEach((k) => {
                    if (Array.isArray(legData?.[k])) {
                        merged[k] = [...(merged[k] || []), ...legData[k]];
                    }
                });
            }
            return res.json({ success: true, data: merged });
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

/**
 * Book ONE leg (one ResultIndex) — same LCC / non-LCC logic as the single
 * booking path, but returns the raw TBO response instead of ending the HTTP
 * request. Used by the round-trip path only.
 */
/**
 * GDS (non-LCC) Book passengers must not carry the LCC-shaped `MealDynamic`
 * array: the SSR for GDS flights returns static meals as `Meal: [{Code,
 * Description}]`, the app stores the pick under MealDynamic, and TBO then
 * fails to deserialise the text Description as Int64 ("'VEGETARIAN HINDU
 * MEAL' cannot be parsed as the type 'Int64'") — the whole Book is rejected
 * after the customer has paid. For GDS, TBO expects a single `Meal` object
 * per passenger; SeatDynamic (numeric fields, priced GDS seat maps) and
 * Baggage are passed through unchanged.
 */
const toGdsPassenger = (pax) => {
    const out = { ...pax };
    const meals = Array.isArray(pax.MealDynamic) ? pax.MealDynamic.filter(Boolean) : [];
    const isStaticMeal = (m) => m && typeof m.Code === 'string' && (m.Price === undefined || typeof m.Description === 'string');
    if (!out.Meal && meals.length && isStaticMeal(meals[0])) {
        out.Meal = { Code: String(meals[0].Code), Description: String(meals[0].Description || '') };
    }
    if (meals.length && meals.some(isStaticMeal)) delete out.MealDynamic;
    if (out.Meal && typeof out.Meal === 'string') out.Meal = { Code: out.Meal, Description: '' };
    return out;
};

const bookOneLeg = async ({ TraceId, ResultIndex, Passengers, isLCC, IsPriceChangeAccepted }) => {
    const endUserIp = process.env.END_USER_IP;

    if (isLCC === true) {
        const lccPayload = {
            PreferredCurrency: null,
            AgentReferenceNo: `PAYMM_${Date.now()}`,
            Passengers,
            EndUserIp: endUserIp,
            TraceId,
            ResultIndex,
            IsPriceChangeAccepted: IsPriceChangeAccepted || false
        };
        return tboService.ticketLCC(lccPayload);
    }

    // Non-LCC: Hold (Book) then Ticket
    const bookResponse = await tboService.bookNonLCC({
        PreferredCurrency: null,
        Passengers: Passengers.map(toGdsPassenger),
        EndUserIp: endUserIp,
        TraceId,
        ResultIndex
    });

    if (bookResponse.Response && bookResponse.Response.Error && bookResponse.Response.Error.ErrorCode !== 0) {
        return bookResponse;
    }

    const bookingMainResponse = bookResponse.Response?.Response;
    if (!bookingMainResponse) {
        return { Response: { Error: { ErrorCode: 100, ErrorMessage: 'Invalid Book response from supplier' }, Response: null } };
    }

    const bookedPassengers = bookingMainResponse.FlightItinerary?.Passenger || [];
    const passportPayload = Passengers.map((pax, index) => ({
        PaxId: bookedPassengers[index]?.PaxId,
        PassportNo: pax.PassportNo || "",
        PassportExpiry: pax.PassportExpiry || "",
        DateOfBirth: pax.DateOfBirth,
    }));

    return tboService.ticketNonLCC({
        EndUserIp: endUserIp,
        TraceId,
        PNR: bookingMainResponse.PNR,
        BookingId: bookingMainResponse.BookingId,
        Passport: passportPayload,
        IsPriceChangeAccepted: IsPriceChangeAccepted || false
    });
};

/**
 * Domestic return: the combined "IDX1,IDX2" ResultIndex is booked as TWO
 * independent TBO bookings (that is how TBO models domestic returns). Each leg
 * is re-quoted first so it books with its OWN fare and its OWN LCC flag — the
 * legs can be different airlines and different fare families. SSR picks are
 * split per leg by segment (Origin|Destination), so nothing is charged twice.
 * On success the two responses are merged into one normal-looking ticket
 * response (combined PNR, merged segments/fare) for the payment server + app.
 */
const bookRoundTripLegs = async ({ TraceId, indexes, Passengers, IsPriceChangeAccepted }) => {
    const legOutcomes = [];

    for (let i = 0; i < indexes.length; i++) {
        const idx = indexes[i];
        const legName = i === 0 ? 'Onward' : 'Return';

        // 1. Fresh quote — authoritative fare + LCC flag for this leg
        let quote;
        try {
            quote = await tboService.getFareQuote({
                EndUserIp: process.env.END_USER_IP,
                TraceId,
                ResultIndex: idx
            });
        } catch (e) {
            quote = null;
        }
        const quoteError = !quote || !quote.Results || (quote.Error && quote.Error.ErrorCode !== 0);
        if (quoteError) {
            const msg = `${legName} leg fare quote failed: ${quote?.Error?.ErrorMessage || 'no results'}`;
            console.error(`Paymm RT: ${msg}`);
            return roundTrip.roundTripFailure(
                legOutcomes.length
                    ? `${msg}. IMPORTANT: onward leg already ticketed (PNR ${legOutcomes[0].pnr || 'unknown'}) — needs manual attention.`
                    : msg,
                legOutcomes.map(o => ({ pnr: o.pnr, bookingId: o.bookingId, response: o.response }))
            );
        }

        const legIsLCC = quote.Results.IsLCC === true || quote.Results.IsLCC === 'true';
        const legFare = quote.Results.Fare;
        const pairSet = roundTrip.legSegmentPairs(quote.Results);

        // 2. Per-leg passengers: leg fare + only this leg's SSR selections
        const legPassengers = Passengers.map((pax) => ({
            ...pax,
            Fare: legFare || pax.Fare,
            Baggage: roundTrip.filterSSRForLeg(pax.Baggage, pairSet, i === 0),
            MealDynamic: roundTrip.filterSSRForLeg(pax.MealDynamic, pairSet, i === 0),
            SeatDynamic: roundTrip.filterSSRForLeg(pax.SeatDynamic, pairSet, i === 0),
        }));

        console.log(`Paymm RT: Booking ${legName} leg [index=${idx}, isLCC=${legIsLCC}]`);

        // 3. Book this leg
        let legResponse;
        try {
            legResponse = await bookOneLeg({
                TraceId,
                ResultIndex: idx,
                Passengers: legPassengers,
                isLCC: legIsLCC,
                IsPriceChangeAccepted
            });
        } catch (e) {
            legResponse = { Response: { Error: { ErrorCode: 100, ErrorMessage: e.message }, Response: null } };
        }

        const outcome = roundTrip.readBookOutcome(legResponse);
        if (outcome.error || !outcome.pnr) {
            const msg = `${legName} leg booking failed: ${outcome.error?.ErrorMessage || 'no PNR returned'}`;
            console.error(`Paymm RT: ${msg}`);
            return roundTrip.roundTripFailure(
                legOutcomes.length
                    ? `${msg}. IMPORTANT: onward leg already ticketed (PNR ${legOutcomes[0].pnr || 'unknown'}) — needs manual attention.`
                    : msg,
                [...legOutcomes.map(o => ({ pnr: o.pnr, bookingId: o.bookingId, response: o.response })),
                 { pnr: outcome.pnr, bookingId: outcome.bookingId, response: legResponse }]
            );
        }

        console.log(`Paymm RT: ${legName} leg ticketed. PNR: ${outcome.pnr}`);
        legOutcomes.push({ ...outcome, response: legResponse });
    }

    return roundTrip.mergeBookedLegs(legOutcomes[0].response, legOutcomes[1].response);
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

        // --- Domestic return (two indexes joined with a comma) ---
        if (roundTrip.isCombinedIndex(ResultIndex)) {
            const indexes = roundTrip.splitResultIndexes(ResultIndex);
            if (indexes.length !== 2) {
                return res.status(400).json({ error: 'A return booking needs exactly two result indexes.' });
            }
            console.log(`Paymm: Initiating Round-Trip booking [${indexes.join(' + ')}]`);
            const combined = await bookRoundTripLegs({ TraceId, indexes, Passengers, IsPriceChangeAccepted });
            if (combined?.Response?.Error?.ErrorCode === 0 && combined?.Response?.Response?.FlightItinerary) {
                sendTelegramNotification(combined);
            }
            return res.status(200).json(combined);
        }

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



            if (data?.Response?.Error?.ErrorCode === 0 && data?.Response?.Response?.FlightItinerary) {
                sendTelegramNotification(data);
            }

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



            // Check if Book step failed
            if (bookResponse.Response && bookResponse.Response.Error && bookResponse.Response.Error.ErrorCode !== 0) {
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



            if (ticketResponse?.Response?.Error?.ErrorCode === 0 && ticketResponse?.Response?.Response?.FlightItinerary) {
                sendTelegramNotification(ticketResponse);
            }

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

const getBookingDetails = async (req, res) => {
    try {
        const { PNR, BookingId, TraceId, FirstName, LastName } = req.body;
        // User IP is required either from body or env
        const EndUserIp = process.env.END_USER_IP;

        if (!BookingId && !PNR && !TraceId) {
            return res.status(400).json({ error: 'At least one of BookingId, PNR, or TraceId is required.' });
        }

        const payload = {
            EndUserIp,
            BookingId,
            PNR,
            TraceId,
            FirstName,
            LastName
        };

        const data = await tboService.getBookingDetails(payload);
        res.json(data);
    } catch (error) {
        console.error('Get Booking Details Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch booking details' });
    }
};

const getCalendarFare = async (req, res) => {
    try {
        const { JourneyType, PreferredAirlines, Segments, Sources } = req.body;
        
        // Basic validation
        if (!Segments || Segments.length === 0) {
            return res.status(400).json({ error: 'Segments parameter is required.' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            JourneyType: JourneyType || 1,
            PreferredAirlines: PreferredAirlines || null,
            Segments,
            Sources: Sources || null
        };

        const data = await tboService.getCalendarFare(payload);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Get Calendar Fare Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
};

const updateCalendarFareOfDay = async (req, res) => {
    try {
        const { JourneyType, PreferredAirlines, Segments, Sources } = req.body;
        
        // Basic validation
        if (!Segments || Segments.length === 0) {
            return res.status(400).json({ error: 'Segments parameter is required.' });
        }

        const payload = {
            EndUserIp: process.env.END_USER_IP,
            JourneyType: JourneyType || 1,
            PreferredAirlines: PreferredAirlines || null,
            Segments,
            Sources: Sources || null
        };

        const data = await tboService.updateCalendarFareOfDay(payload);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Update Calendar Fare Of Day Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ success: false, error: error.response.data });
        } else {
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
}

module.exports = {
    search,
    getFareRule,
    getFareQuote,
    getSSR,
    bookFlight,
    getBookingDetails,
    getCalendarFare,
    updateCalendarFareOfDay
};
