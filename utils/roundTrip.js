/**
 * roundTrip.js — domestic return (round-trip) support.
 *
 * TBO models a domestic return search as two independent result lists
 * (Results[0] = onward, Results[1] = return). The app selects one flight from
 * each and sends BOTH indexes as a single comma-joined ResultIndex
 * ("IDX1,IDX2"). TBO itself has no notion of that combined index — every
 * downstream call (FareQuote / SSR / FareRule / Book / Ticket) must be made
 * PER LEG and the responses merged. These helpers do the splitting/merging;
 * the controller owns the actual TBO calls.
 */

const isCombinedIndex = (resultIndex) =>
  typeof resultIndex === 'string' && resultIndex.includes(',');

const splitResultIndexes = (resultIndex) =>
  String(resultIndex || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Merge two transformFareQuote() outputs (onward + return) into the single
 * Shape-1 object the app already understands: onward fields at the top level,
 * the return leg under `inbound`, prices summed across both legs.
 */
const combineCleanQuotes = (clean1, clean2) => ({
  ...clean1,
  price: {
    total: num(clean1.price?.total) + num(clean2.price?.total),
    base: num(clean1.price?.base) + num(clean2.price?.base),
    taxes: num(clean1.price?.taxes) + num(clean2.price?.taxes),
    offeredFare: num(clean1.price?.offeredFare) + num(clean2.price?.offeredFare),
  },
  inbound: {
    airline: clean2.airline || '',
    flightNumbers: clean2.flightNumbers || '',
    fromCode: clean2.segments?.[0]?.from || '',
    toCode: clean2.segments?.[clean2.segments.length - 1]?.to || '',
    departureTime: clean2.departureTime || '',
    arrivalTime: clean2.arrivalTime || '',
    totalDuration: clean2.totalDuration || '',
    stops: clean2.stops ?? 0,
    segments: clean2.segments || [],
  },
});

/** Sum two raw TBO Fare objects field-by-field (for the merged itinerary). */
const sumFares = (f1 = {}, f2 = {}) => {
  const out = { ...f1 };
  const keys = new Set([...Object.keys(f1 || {}), ...Object.keys(f2 || {})]);
  keys.forEach((k) => {
    const a = f1 ? f1[k] : undefined;
    const b = f2 ? f2[k] : undefined;
    if (typeof a === 'number' || typeof b === 'number') out[k] = num(a) + num(b);
  });
  if (f1 && f1.Currency) out.Currency = f1.Currency;
  return out;
};

/** Flatten TBO's Segments (array-of-arrays or flat) into one flat array. */
const flattenSegments = (segments) => {
  const flat = [];
  (Array.isArray(segments) ? segments : []).forEach((s) => {
    if (Array.isArray(s)) flat.push(...s);
    else if (s) flat.push(s);
  });
  return flat;
};

/** "ORIGIN|DEST" pairs a leg's quote covers — used to split SSR picks per leg. */
const legSegmentPairs = (quoteResults) => {
  const pairs = new Set();
  flattenSegments(quoteResults?.Segments).forEach((seg) => {
    const o = seg?.Origin?.Airport?.AirportCode || seg?.Origin?.AirportCode;
    const d = seg?.Destination?.Airport?.AirportCode || seg?.Destination?.AirportCode;
    if (o && d) pairs.add(`${o}|${d}`);
  });
  return pairs;
};

/**
 * Keep only the SSR selections (baggage/meal/seat) that belong to this leg's
 * segments. Items without Origin/Destination can't be attributed — they go to
 * the first leg only, so they are never charged twice.
 */
const filterSSRForLeg = (items, pairSet, isFirstLeg) => {
  if (!Array.isArray(items)) return [];
  return items.filter((it) => {
    if (!it) return false;
    const o = it.Origin, d = it.Destination;
    if (!o || !d) return isFirstLeg;
    return pairSet.has(`${o}|${d}`);
  });
};

/** Extract {pnr, bookingId, itinerary, error} from a raw book/ticket response. */
const readBookOutcome = (resp) => {
  const outer = resp?.Response || resp || {};
  const inner = outer.Response || {};
  const itinerary = inner.FlightItinerary || null;
  const error = outer.Error && outer.Error.ErrorCode !== 0 ? outer.Error : null;
  let pnr = (inner.PNR || (itinerary && itinerary.PNR) || '').trim();
  if (!pnr && itinerary && Array.isArray(itinerary.Passenger)) {
    for (const pax of itinerary.Passenger) {
      const t = pax?.Ticket?.TicketNumber;
      if (t && String(t).trim()) { pnr = String(t).trim(); break; }
    }
  }
  return { pnr, bookingId: inner.BookingId || (itinerary && itinerary.BookingId) || null, itinerary, error };
};

/**
 * Merge two successful leg responses into ONE response shaped like a normal
 * TBO ticket response, so the payment server (PNR extraction, success check)
 * and the app (itinerary render, coins unlock from last ArrTime) keep working
 * unchanged. Both raw leg responses ride along under Response.Legs.
 */
const mergeBookedLegs = (resp1, resp2) => {
  const a = readBookOutcome(resp1);
  const b = readBookOutcome(resp2);
  const pnr = [a.pnr, b.pnr].filter(Boolean).join(', ');

  const it1 = a.itinerary || {};
  const it2 = b.itinerary || {};
  // TripIndicator marks which leg a segment belongs to (1 = onward, 2 = return)
  // — the app's ticket view and the coins label both read it.
  const onwardSegs = flattenSegments(it1.Segments).map((s) => ({ ...s, TripIndicator: 1 }));
  const returnSegs = flattenSegments(it2.Segments).map((s) => ({ ...s, TripIndicator: 2 }));
  const mergedItinerary = {
    ...it1,
    PNR: pnr,
    Segments: [...onwardSegs, ...returnSegs],
    Fare: sumFares(it1.Fare, it2.Fare),
    // Onward passengers carry the ticket info shown on the success screen;
    // per-leg passenger/ticket detail stays available under Legs.
  };

  return {
    Response: {
      Error: { ErrorCode: 0, ErrorMessage: '' },
      ResponseStatus: 1,
      TraceId: (resp1?.Response && resp1.Response.TraceId) || undefined,
      Response: {
        ...((resp1?.Response && resp1.Response.Response) || {}),
        PNR: pnr,
        BookingId: a.bookingId,
        FlightItinerary: mergedItinerary,
      },
      Legs: [
        { pnr: a.pnr, bookingId: a.bookingId, response: resp1 },
        { pnr: b.pnr, bookingId: b.bookingId, response: resp2 },
      ],
    },
  };
};

/**
 * Failure response for the round-trip path. Uses ErrorCode 100 deliberately:
 * the payment server retries whole book calls on ErrorCode 3 (LCC mismatch)
 * and 28 (in-process) — a retry after leg 1 has ticketed would double-book,
 * so round-trip failures must never surface those codes.
 */
const roundTripFailure = (message, legs) => ({
  Response: {
    Error: { ErrorCode: 100, ErrorMessage: message },
    ResponseStatus: 3,
    Response: null,
    Legs: legs || [],
  },
});

module.exports = {
  isCombinedIndex,
  splitResultIndexes,
  combineCleanQuotes,
  sumFares,
  flattenSegments,
  legSegmentPairs,
  filterSSRForLeg,
  readBookOutcome,
  mergeBookedLegs,
  roundTripFailure,
};
