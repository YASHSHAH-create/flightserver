const axios = require('axios');

let tokenId = null;

const authenticate = async () => {
    try {
        const AUTH_URL = process.env.AUTH_API_URL || 'http://Sharedapi.tektravels.com/SharedData.svc/rest/Authenticate';

        const response = await axios.post(AUTH_URL, {
            ClientId: process.env.CLIENT_ID,
            UserName: process.env.USERNAME,
            Password: process.env.PASSWORD,
            EndUserIp: process.env.END_USER_IP
        });

        if (response.data && response.data.TokenId) {
            tokenId = response.data.TokenId;
            console.log('Hotel Authentication successful. TokenId:', tokenId);
            return tokenId;
        } else {
            console.error('Hotel Authentication failed:', response.data);
            return null;
        }
    } catch (error) {
        console.error('Error during Hotel authentication:', error.message);
        throw error;
    }
};

const getToken = async () => {
    if (!tokenId) {
        console.log('TokenId is null, initiating authentication...');
        await authenticate();
    }
    return tokenId;
};

// 2. Destination Search
const getDestinationSearch = async (payload) => {
    payload.TokenId = await getToken();
    // Use HotelBE since Sharedapi failed
    const URL = "https://HotelBE.tektravels.com/SharedServices/StaticData.svc/rest/GetDestinationSearchStaticData";

    try {
        console.log('Sending Destination Search request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in Destination Search:', error.message);
        throw error;
    }
};

// 3. Hotel Search
const searchHotels = async (payload) => {
    payload.TokenId = await getToken();
    // Try HotelBE domain based on .env hint, assume HTTPS
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/GetHotelResult";

    try {
        console.log('Sending Hotel Search request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);

        if (response.data && response.data.Error && response.data.Error.ErrorCode !== 0) {
            if (response.data.Error.ErrorMessage && response.data.Error.ErrorMessage.includes("Session is not valid")) {
                console.log("Session invalid, re-authenticating...");
                await authenticate();
                payload.TokenId = tokenId;
                const retryResponse = await axios.post(URL, payload);
                return retryResponse.data;
            }
        }

        return response.data;
    } catch (error) {
        console.error('Error in Hotel Search:', error.message);
        throw error;
    }
};

// 4. Hotel Room Availability
const getHotelRoom = async (payload) => {
    payload.TokenId = await getToken();
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/GetHotelRoom";

    try {
        console.log('Sending Get Hotel Room request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in GetHotelRoom:', error.message);
        throw error;
    }
};

// 5. Block Room
const blockRoom = async (payload) => {
    payload.TokenId = await getToken();
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/BlockRoom";

    try {
        console.log('Sending Block Room request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in BlockRoom:', error.message);
        throw error;
    }
};

// 6. Book (Commit Booking)
const bookHotel = async (payload) => {
    payload.TokenId = await getToken();
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/Book";

    try {
        console.log('Sending Book Hotel request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in BookHotel:', error.message);
        throw error;
    }
};

// 7. Generate Voucher
const generateVoucher = async (payload) => {
    payload.TokenId = await getToken();
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/GenerateVoucher";

    try {
        console.log('Sending Generate Voucher request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in GenerateVoucher:', error.message);
        throw error;
    }
};

// 8. Hotel Cancellation
const cancelBooking = async (payload) => {
    payload.TokenId = await getToken();
    const URL = "https://HotelBE.tektravels.com/HotelService.svc/rest/SendChangeRequest";

    try {
        console.log('Sending Cancellation request:', JSON.stringify(payload, null, 2));
        const response = await axios.post(URL, payload);
        return response.data;
    } catch (error) {
        console.error('Error in CancelBooking:', error.message);
        throw error;
    }
};

module.exports = {
    authenticate,
    getToken,
    getDestinationSearch,
    searchHotels,
    getHotelRoom,
    blockRoom,
    bookHotel,
    generateVoucher,
    cancelBooking
};
