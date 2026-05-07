/**
 * Utility to transform TBO FareQuote API response into a clean, UI-friendly JSON format.
 */

/**
 * Format minutes to a readable string (e.g. "2h 20m")
 * @param {number} minutes 
 * @returns {string}
 */
const formatDuration = (minutes) => {
  if (minutes == null || isNaN(minutes) || minutes < 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h > 0 ? h + 'h ' : ''}${m}m`.trim();
};

/**
 * Format ISO datetime string (e.g., "2023-11-20T08:00:00") to "HH:mm"
 * string slicing is much faster and avoids timezone shift side-effects
 * @param {string} dateTimeStr 
 * @returns {string}
 */
const formatTime = (dateTimeStr) => {
  if (!dateTimeStr || typeof dateTimeStr !== 'string') return '';
  const timePart = dateTimeStr.split('T')[1];
  if (timePart) {
    return timePart.substring(0, 5); // Extract HH:mm
  }
  return '';
};

/**
 * Parses a "YYYY-MM-DDTHH:mm:ss" string to a UTC timestamp for safe difference calculation
 * @param {string} dateTimeStr 
 * @returns {number}
 */
const parseSafeTime = (dateTimeStr) => {
  if (!dateTimeStr) return 0;
  return new Date(dateTimeStr + 'Z').getTime(); // Append Z to cleanly treat as UTC
};

/**
 * Transforms raw TBO FareQuote response into a minimal, UI-friendly shape
 * Optimized for frontend rendering and low response payload size.
 *
 * @param {Object} rawData 
 * @returns {Object}
 */
const transformFareQuote = (rawData) => {
  // Extract results safely to handle both top-level and nested TBO structures
  const result = rawData?.Response?.Results || rawData?.Results || rawData;

  if (!result || !result.Segments || !result.Segments[0]) {
    throw new Error('Invalid TBO Response format: Missing Segments');
  }

  const fare = result.Fare || {};
  
  // TBO Segments is typically a 2D array. Segment[0] is the outbound leg.
  const outboundSegments = result.Segments[0];
  
  if (!Array.isArray(outboundSegments) || outboundSegments.length === 0) {
    throw new Error('No outbound segments found');
  }

  const firstSegment = outboundSegments[0];
  const lastSegment = outboundSegments[outboundSegments.length - 1];

  const stops = outboundSegments.length - 1;
  const isConnectingFlight = stops > 0;

  let totalDurationMinutes = 0;
  let totalLayoverMinutes = 0;
  let isLongLayover = false;
  
  const routeAirports = [];
  const flightNumbers = [];
  const stopCities = [];

  const transformedSegments = outboundSegments.map((seg, index) => {
    const originCode = seg.Origin?.Airport?.AirportCode || seg.Origin?.AirportCode || '';
    const destCode = seg.Destination?.Airport?.AirportCode || seg.Destination?.AirportCode || '';
    
    // Build route pattern
    if (index === 0) routeAirports.push(originCode);
    routeAirports.push(destCode);

    // Build flight numbers
    const airlineCode = seg.Airline?.AirlineCode || '';
    const flightNum = seg.Airline?.FlightNumber || '';
    const flightIdentifier = `${airlineCode}-${flightNum}`;
    flightNumbers.push(flightIdentifier);

    const segDuration = seg.Duration || 0;
    
    // Layover calculation
    let groundTime = seg.GroundTime || 0;
    
    if (index < stops) {
      if (!groundTime) {
        // Fallback calculation: next segment departure - current segment arrival
        const nextSeg = outboundSegments[index + 1];
        if (seg.Destination?.ArrTime && nextSeg?.Origin?.DepTime) {
          const arrTs = parseSafeTime(seg.Destination.ArrTime);
          const depTs = parseSafeTime(nextSeg.Origin.DepTime);
          if (depTs > arrTs) {
            groundTime = Math.floor((depTs - arrTs) / 60000);
          }
        }
      }
      
      totalLayoverMinutes += groundTime;
      
      if (groundTime > 360) {
        isLongLayover = true;
      }
      
      const city = seg.Destination?.Airport?.CityName || seg.Destination?.CityName || destCode;
      if (city && !stopCities.includes(city)) {
          stopCities.push(city);
      }
    }

    totalDurationMinutes += segDuration;

    return {
      from: originCode,
      to: destCode,
      departure: formatTime(seg.Origin?.DepTime),
      arrival: formatTime(seg.Destination?.ArrTime),
      duration: formatDuration(segDuration),
      airline: seg.Airline?.AirlineName || '',
      flightNumber: flightIdentifier,
      ...(index < stops && { layoverAfter: formatDuration(groundTime) })
    };
  });

  // Calculate true total journey duration (flight time + ground time)
  totalDurationMinutes += totalLayoverMinutes;

  const firstDepTime = firstSegment.Origin?.DepTime;
  const lastArrTime = lastSegment.Destination?.ArrTime;
  
  // Fallback total duration using first departure and last arrival times
  if (!totalDurationMinutes && firstDepTime && lastArrTime) {
      const arrTs = parseSafeTime(lastArrTime);
      const depTs = parseSafeTime(firstDepTime);
      if (arrTs > depTs) {
         totalDurationMinutes = Math.floor((arrTs - depTs) / 60000);
      }
  }

  return {
    airline: firstSegment.Airline?.AirlineName || '',
    flightNumbers: flightNumbers.join(', '),
    route: routeAirports.join(' → '),
    departureTime: formatTime(firstDepTime),
    arrivalTime: formatTime(lastArrTime),
    totalDuration: formatDuration(totalDurationMinutes),
    stops,
    stopCity: stopCities.join(', '), 
    layover: isConnectingFlight ? formatDuration(totalLayoverMinutes) : '',
    isConnectingFlight,
    isLongLayover,
    price: {
      total: fare.PublishedFare || 0,
      base: fare.BaseFare || 0,
      taxes: fare.Tax || 0,
      offeredFare: fare.OfferedFare || 0 
    },
    baggage: {
      checkin: firstSegment.Baggage || 'Not available',
      cabin: firstSegment.CabinBaggage || 'Not available'
    },
    segments: transformedSegments,
    ...(result.Segments[1] && result.Segments[1].length > 0 ? {
      inbound: (() => {
        const inboundSegments = result.Segments[1];
        const stops = inboundSegments.length - 1;
        let totalDurationMinutes = 0;
        let totalLayoverMinutes = 0;
        
        const mappedSegments = inboundSegments.map((seg, index) => {
          const originCode = seg.Origin?.Airport?.AirportCode || seg.Origin?.AirportCode || '';
          const destCode = seg.Destination?.Airport?.AirportCode || seg.Destination?.AirportCode || '';
          const airlineCode = seg.Airline?.AirlineCode || '';
          const flightNum = seg.Airline?.FlightNumber || '';
          const flightIdentifier = `${airlineCode}-${flightNum}`;
          const segDuration = seg.Duration || 0;
          let groundTime = seg.GroundTime || 0;

          if (index < stops) {
            if (!groundTime) {
              const nextSeg = inboundSegments[index + 1];
              if (seg.Destination?.ArrTime && nextSeg?.Origin?.DepTime) {
                const arrTs = parseSafeTime(seg.Destination.ArrTime);
                const depTs = parseSafeTime(nextSeg.Origin.DepTime);
                if (depTs > arrTs) {
                  groundTime = Math.floor((depTs - arrTs) / 60000);
                }
              }
            }
            totalLayoverMinutes += groundTime;
          }
          
          totalDurationMinutes += segDuration;

          return {
            from: originCode,
            to: destCode,
            departure: formatTime(seg.Origin?.DepTime),
            arrival: formatTime(seg.Destination?.ArrTime),
            duration: formatDuration(segDuration),
            airline: seg.Airline?.AirlineName || '',
            flightNumber: flightIdentifier,
            ...(index < stops && { layoverAfter: formatDuration(groundTime) })
          };
        });

        totalDurationMinutes += totalLayoverMinutes;
        
        const firstDepTime = inboundSegments[0].Origin?.DepTime;
        const lastArrTime = inboundSegments[inboundSegments.length - 1].Destination?.ArrTime;
        if (!totalDurationMinutes && firstDepTime && lastArrTime) {
            const arrTs = parseSafeTime(lastArrTime);
            const depTs = parseSafeTime(firstDepTime);
            if (arrTs > depTs) {
               totalDurationMinutes = Math.floor((arrTs - depTs) / 60000);
            }
        }

        return {
          airline: inboundSegments[0].Airline?.AirlineName || '',
          flightNumbers: inboundSegments.map(s => `${s.Airline?.AirlineCode || ''}-${s.Airline?.FlightNumber || ''}`).join(', '),
          route: `${inboundSegments[0].Origin?.Airport?.AirportCode || inboundSegments[0].Origin?.AirportCode || ''} → ${inboundSegments[inboundSegments.length - 1].Destination?.Airport?.AirportCode || inboundSegments[inboundSegments.length - 1].Destination?.AirportCode || ''}`,
          departureTime: formatTime(inboundSegments[0].Origin?.DepTime),
          arrivalTime: formatTime(inboundSegments[inboundSegments.length - 1].Destination?.ArrTime),
          totalDuration: formatDuration(totalDurationMinutes),
          stops,
          segments: mappedSegments
        };
      })()
    } : {})
  };
};

module.exports = {
  transformFareQuote,
  formatDuration,
  formatTime
};
