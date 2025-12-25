const {
    getSeatTypeEnum,
    getAvailabilityTypeEnum,
    getDeckEnum,
    getCompartmentEnum,
    getWayTypeEnum
} = require('./enums');

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

// Helper to transform TBO search response
const transformSearchResponse = (tboResponse) => {
    if (!tboResponse || !tboResponse.Response || !tboResponse.Response.Results) {
        return [];
    }

    const { TraceId, Results } = tboResponse.Response;
    const flightResults = Results[0] || [];

    return flightResults.map(res => {
        // Flatten segments: TBO segments can be array of arrays
        let allSegments = [];
        if (Array.isArray(res.Segments)) {
            res.Segments.forEach(segArr => {
                if (Array.isArray(segArr)) allSegments = allSegments.concat(segArr);
                else allSegments.push(segArr);
            });
        }

        // Split into Outbound (TripIndicator 1) and Inbound (TripIndicator 2)
        const outboundSegs = allSegments.filter(s => s.TripIndicator === 1 || !s.TripIndicator);
        const inboundSegs = allSegments.filter(s => s.TripIndicator === 2);

        const mapLeg = (segments) => {
            if (!segments || segments.length === 0) return null;

            const mappedSegments = segments.map(s => ({
                airlineCode: s.Airline?.AirlineCode,
                flightNumber: s.Airline?.FlightNumber,
                origin: s.Origin?.Airport?.AirportCode,
                originCity: s.Origin?.Airport?.CityName,
                destination: s.Destination?.Airport?.AirportCode,
                destinationCity: s.Destination?.Airport?.CityName,
                depTime: s.Origin?.DepTime,
                arrTime: s.Destination?.ArrTime,
                duration: s.Duration,
                baggage: s.Baggage, // Expecting string like "15 Kg"
                layoverTime: 0
            }));

            // Calculate layover times
            for (let i = 0; i < mappedSegments.length - 1; i++) {
                const arrival = new Date(mappedSegments[i].arrTime);
                const departure = new Date(mappedSegments[i + 1].depTime);
                const diffMins = Math.floor((departure - arrival) / (1000 * 60));
                mappedSegments[i].layoverTime = diffMins > 0 ? diffMins : 0;
            }

            // Calculate total duration for the leg
            const firstDep = new Date(mappedSegments[0].depTime);
            const lastArr = new Date(mappedSegments[mappedSegments.length - 1].arrTime);
            const totalDuration = Math.floor((lastArr - firstDep) / (1000 * 60));

            return {
                duration: totalDuration,
                stops: Math.max(0, mappedSegments.length - 1),
                airlineName: segments[0].Airline?.AirlineName,
                segments: mappedSegments
            };
        };

        const outbound = mapLeg(outboundSegs);
        const inbound = mapLeg(inboundSegs);

        const optimized = {
            searchId: TraceId,
            resultIndex: res.ResultIndex,
            source: res.Source,
            isRefundable: res.IsRefundable,
            isLCC: res.IsLCC,
            price: {
                currency: res.Fare?.Currency,
                total: res.Fare?.PublishedFare,
                base: res.Fare?.BaseFare,
                tax: res.Fare?.Tax
            },
            flights: {
                outbound: outbound
            }
        };

        if (inbound) {
            optimized.flights.inbound = inbound;
        }

        return optimized;
    });
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

// Helper function to convert seat letter to number
const seatLetterToNumber = (letter) => {
    const map = {
        'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6,
        'G': 7, 'H': 8, 'I': 9, 'J': 10, 'K': 11, 'L': 12,
        'M': 13, 'N': 14
    };
    return map[letter?.toUpperCase()] || 0;
};

module.exports = {
    formatDate,
    getClassCode,
    transformSearchResponse,
    processRowSeats,
    enhanceSeatInfo,
    processSSRResponse,
    seatLetterToNumber
};
