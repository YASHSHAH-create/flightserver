const axios = require('axios');
const { transformSearchResponse, processSSRResponse } = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

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
let tokenDate = null;
const todayStr = () => new Date().toISOString().slice(0, 10); 

const authenticate = async () => {
    try {
        const authPayload = {
            ClientId: process.env.CLIENT_ID,
            UserName: process.env.USERNAME,
            Password: process.env.PASSWORD,
            EndUserIp: process.env.END_USER_IP
        };
        
        console.log("=== TBO AUTHENTICATION INFO ===");
        console.log("AUTH URL:", process.env.AUTH_API_URL);
        console.log("AUTH CREDENTIALS BEING SENT:", {
            ClientId: process.env.CLIENT_ID,
            UserName: process.env.USERNAME,
            Password: process.env.PASSWORD,
            EndUserIp: process.env.END_USER_IP
        });
        console.log("===============================");

        const response = await axios.post(process.env.AUTH_API_URL, authPayload);

        if (response.data && response.data.TokenId) {
            tokenId = response.data.TokenId;
            tokenDate = todayStr();
            console.log(`TBO Auth successful. TokenId: ${tokenId} (valid for today: ${tokenDate})`);
            return tokenId;
        } else {
            console.error('TBO Auth failed:', response.data);
            return null;
        }
    } catch (error) {
        console.error('Error during TBO authentication:', error.message);
        throw error;
    }
};

const getToken = async () => {
    const today = todayStr();
    if (!tokenId || tokenDate !== today) {
        // No token yet, or token is from a previous calendar day — re-authenticate
        if (tokenDate && tokenDate !== today) {
            console.log(`TBO Token expired (was for ${tokenDate}, today is ${today}). Re-authenticating...`);
        } else {
            console.log('TBO TokenId is null, initiating first authentication...');
        }
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

        // Save raw response to flight.json
        try {
            fs.writeFileSync(path.join(__dirname, '../flight.json'), JSON.stringify(response.data, null, 2));
            console.log('Saved raw TBO response to flight.json');
        } catch (err) {
            console.error('Error saving raw TBO response to flight.json:', err.message);
        }

        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            if (isSessionInvalidError(response.data.Error)) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(process.env.SEARCH_API_URL, payload);
                
                try {
                    fs.writeFileSync(path.join(__dirname, '../flight.json'), JSON.stringify(retryResponse.data, null, 2));
                    console.log('Saved raw TBO response (retry) to flight.json');
                } catch (err) {
                    console.error('Error saving raw TBO response to flight.json:', err.message);
                }
                
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
    payload.TokenId = await getToken(); // Use daily cached token per TBO docs
    const TBO_TICKET_URL = process.env.TICKET_API_URL;

    console.log('Sending LCC Ticket request:', JSON.stringify(payload, null, 2));
    try {
        const response = await axios.post(TBO_TICKET_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            // ErrorCode 6 here almost always means the TraceId/search session expired,
            // NOT the token (token is daily and was just validated above).
            console.error(`ticketLCC: ErrorCode=${error.ErrorCode} ("${error.ErrorMessage}"). TraceId has likely expired — user must search again.`);
            return response.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const bookNonLCC = async (payload) => {
    payload.TokenId = await getToken(); // Use daily cached token per TBO docs
    const TBO_BOOK_URL = process.env.BOOK_API_URL;
    
    console.log('=== TBO BOOK API INFO ===');
    console.log('BOOK API URL:', TBO_BOOK_URL);
    console.log('Sending Non-LCC Book request Payload:', JSON.stringify(payload, null, 2));
    console.log('=========================');
    
    try {
        const response = await axios.post(TBO_BOOK_URL, payload);

        const error = response.data.Error || (response.data.Response && response.data.Response.Error);
        if (error && error.ErrorCode !== 0 && isSessionInvalidError(error)) {
            // ErrorCode 6 here almost always means the TraceId/search session expired,
            // NOT the token (token is daily and was just validated above).
            // A new token cannot revive an expired TraceId — user must search again.
            console.error(`bookNonLCC: ErrorCode=${error.ErrorCode} ("${error.ErrorMessage}"). TraceId has likely expired — user must search again.`);
            return response.data;
        }

        return response.data;
    } catch (error) {
        throw error;
    }
};

const ticketNonLCC = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_TICKET_URL = process.env.TICKET_API_URL;
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
    const TBO_GET_BOOKING_DETAILS_URL = "https://booking.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/GetBookingDetails";
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
    const TBO_GET_CALENDAR_FARE_URL = "https://tboapi.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/GetCalendarFare";
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
    const TBO_UPDATE_CALENDAR_FARE_URL = "https://tboapi.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/UpdateCalendarFareOfDay";
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
