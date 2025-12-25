const axios = require('axios');
const { transformSearchResponse, processSSRResponse } = require('../utils/helpers');

let tokenId = null;

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
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
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
            if (response.data.Error.ErrorMessage.includes("Session is not valid")) {
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
            if (response.data.Response.Error.ErrorMessage.includes("Session is not valid")) {
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
            if (response.data.Response.Error.ErrorMessage.includes("Session is not valid")) {
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
    payload.TokenId = await getToken();
    // TBO_BASE_URL was defined locally in index.js, assuming it matches the pattern or uses env
    // The original code had: const TBO_BASE_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest";
    const TBO_TICKET_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Ticket";

    console.log('Sending LCC Ticket request:', JSON.stringify(payload, null, 2));
    const response = await axios.post(TBO_TICKET_URL, payload);
    return response.data;
};

const bookNonLCC = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_BOOK_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Book";
    console.log('Sending Non-LCC Book request:', JSON.stringify(payload, null, 2));
    const response = await axios.post(TBO_BOOK_URL, payload);
    return response.data;
};

const ticketNonLCC = async (payload) => {
    payload.TokenId = await getToken();
    const TBO_TICKET_URL = "http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest/Ticket";
    console.log('Sending Non-LCC Ticket request:', JSON.stringify(payload, null, 2));
    const response = await axios.post(TBO_TICKET_URL, payload);
    return response.data;
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
    ticketNonLCC
};
