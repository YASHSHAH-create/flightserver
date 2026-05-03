const axios = require('axios');
const { transformSearchResponse, processSSRResponse } = require('../utils/helpers');

const isSessionInvalidError = (error) => {
    if (!error) return false;
    if (error.ErrorCode === 6 || error.ErrorCode === 28) return true;
    if (error.ErrorMessage) {
        const msg = error.ErrorMessage.toLowerCase();
        if (msg.includes("session is not valid") || msg.includes("invalid token")) {
            return true;
        }
    }
    return false;
};

let tokenId = null;

const authenticate = async () => {
    try {
        const authPayload = {
            ClientId: process.env.CLIENT_ID,
            UserName: process.env.USERNAME,
            Password: process.env.PASSWORD,
            EndUserIp: process.env.END_USER_IP
        };
        console.log("Authentication Credentials:", authPayload);
        
        const response = await axios.post(process.env.AUTH_API_URL, authPayload);

        if (response.data && response.data.TokenId) {
            tokenId = response.data.TokenId;
            console.log('Authentication successful. TokenId:', tokenId);
            return tokenId;
        } else {
            console.error('Authentication failed:', response.data);
            return null;
        }
    } catch (error) {
        console.error('Error during authentication:', error.message);
        throw error;
    }
};

const getToken = async () => {
    if (!tokenId) {
        console.log('TokenId is null, initiating authentication...');
        await authenticate();
    }
    console.log('Using TokenId:', tokenId);
    return tokenId;
};

const searchFlights = async (payload) => {
    payload.TokenId = await getToken();
    console.log('Sending search request:', JSON.stringify(payload, null, 2));

    try {
        const response = await axios.post(process.env.SEARCH_API_URL, payload);

        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            if (isSessionInvalidError(response.data.Error)) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.SEARCH_API_URL, payload);
                return transformSearchResponse(retryResponse.data);
            }
        }
        return transformSearchResponse(response.data);
    } catch (error) {
        throw error;
    }
};

const getFareRule = async (payload) => {
    payload.TokenId = await getToken();

    try {
        const response = await axios.post(process.env.FARE_RULE_API_URL, payload);

        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            if (isSessionInvalidError(response.data.Error)) {
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.FARE_RULE_API_URL, payload);
                return retryResponse.data.Response || retryResponse.data;
            }
        }
        return response.data.Response || response.data;
    } catch (error) {
        throw error;
    }
};

const getFareQuote = async (payload) => {
    payload.TokenId = await getToken();

    try {
        const response = await axios.post(process.env.FARE_QUOTE_API_URL, payload);

        if (response.data && response.data.Response && response.data.Response.Error && response.data.Response.Error.ErrorCode !== 0) {
            if (isSessionInvalidError(response.data.Response.Error)) {
                console.log(`Encountered Error ${response.data.Response.Error.ErrorCode}, re-authenticating...`);
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.FARE_QUOTE_API_URL, payload);
                return retryResponse.data.Response || retryResponse.data;
            }
        }
        return response.data.Response || response.data;
    } catch (error) {
        throw error;
    }
};

const getSSR = async (payload) => {
    payload.TokenId = await getToken();

    try {
        const response = await axios.post(process.env.SSR_API_URL, payload);

        if (response.data && response.data.Response && response.data.Response.Error && response.data.Response.Error.ErrorCode !== 0) {
            if (isSessionInvalidError(response.data.Response.Error)) {
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.SSR_API_URL, payload);
                return processSSRResponse(retryResponse.data.Response);
            }
        }
        return processSSRResponse(response.data.Response || response.data);
    } catch (error) {
        throw error;
    }
};

const ticketLCC = async (payload) => {
    // Always force a fresh authentication before ticketing — critical money operation.
    console.log("ticketLCC: Forcing fresh authentication before Ticket call...");
    await authenticate();
    payload.TokenId = tokenId;

    const TBO_TICKET_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Ticket";

    console.log('Sending LCC Ticket request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_TICKET_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            // ErrorCode 6 with a fresh token = TraceId likely expired
            console.error(`ticketLCC: Session error even after fresh auth. ErrorCode=${error.ErrorCode}, Msg=${error.ErrorMessage}. TraceId likely expired.`);
            return response.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const bookNonLCC = async (payload) => {
    // Always force a fresh authentication before booking — critical money operation.
    // The cached token from search (ensureToken) may be stale after the user completes payment.
    console.log("bookNonLCC: Forcing fresh authentication before Book call...");
    await authenticate();
    payload.TokenId = tokenId;

    const TBO_BOOK_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Book";
    console.log('Sending Non-LCC Book request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_BOOK_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            // ErrorCode 6 with a fresh token means the TraceId/search session has expired.
            // No point retrying — a new token cannot revive an expired TraceId.
            console.error(`bookNonLCC: Session error even after fresh auth. ErrorCode=${error.ErrorCode}, Msg=${error.ErrorMessage}. TraceId likely expired.`);
            return response.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const ticketNonLCC = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_TICKET_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Ticket";
    console.log('Sending Non-LCC Ticket request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_TICKET_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            console.log("Session invalid in ticketNonLCC, re-authenticating...");
            await authenticate();
            payload.TokenId = tokenId;
            const retryResponse = await axios.post(TBO_TICKET_URL, payload);
            return retryResponse.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const getBookingDetails = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_GET_BOOKING_DETAILS_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/GetBookingDetails";
    console.log('Sending GetBookingDetails request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_GET_BOOKING_DETAILS_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            console.log("Session invalid in getBookingDetails, re-authenticating...");
            await authenticate();
            payload.TokenId = tokenId;
            const retryResponse = await axios.post(TBO_GET_BOOKING_DETAILS_URL, payload);
            return retryResponse.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const getCalendarFare = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_GET_CALENDAR_FARE_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/GetCalendarFare";
    console.log('Sending GetCalendarFare request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_GET_CALENDAR_FARE_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            console.log("Session invalid in getCalendarFare, re-authenticating...");
            await authenticate();
            payload.TokenId = tokenId;
            const retryResponse = await axios.post(TBO_GET_CALENDAR_FARE_URL, payload);
            return retryResponse.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const updateCalendarFareOfDay = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_UPDATE_CALENDAR_FARE_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/UpdateCalendarFareOfDay";
    console.log('Sending UpdateCalendarFareOfDay request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_UPDATE_CALENDAR_FARE_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            console.log("Session invalid in updateCalendarFareOfDay, re-authenticating...");
            await authenticate();
            payload.TokenId = tokenId;
            const retryResponse = await axios.post(TBO_UPDATE_CALENDAR_FARE_URL, payload);
            return retryResponse.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

module.exports = {
    authenticate,
    getToken,
    searchFlights,
    getFareRule,
    getFareQuote,
    getSSR,
    ticketLCC,
    bookNonLCC,
    ticketNonLCC,
    getBookingDetails,
    getCalendarFare,
    updateCalendarFareOfDay
};
