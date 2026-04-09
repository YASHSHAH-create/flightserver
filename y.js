const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    baseUrl: 'http://localhost:3001',
    includeSSR: false, // Set to true if you want to fetch SSR details before booking
    airlinePreference: 'AI', // AI = Air India
    search: {
        from: 'DEL',
        to: 'CCU',
        date: '20122026', // Format DDMMYYYY
        adults: 1,
        children: 0,
        infants: 0,
        class: 'Economy', // 'Economy', 'PremiumEconomy', 'Business', 'PremiumBusiness', 'First'
        journeyType: 1 // 1: OneWay, 2: Return, 3: MultiCity
    },
    passengers: [
        {
            Title: "Mr",
            FirstName: "TystYyY",
            LastName: "Userh",
            PaxType: 1, // 1: Adult, 2: Child, 3: Infant
            DateOfBirth: "1990-01-01T00:00:00",
            Gender: 1, // 1: Male, 2: Female
            PassportNo: "A1234686", // Required for non-LCC
            PassportExpiry: "2030-01-01T00:00:00", // Required for non-LCC
            AddressLine1: "123 Main St",
            City: "New Delhi",
            CountryCode: "IN",
            CountryName: "India",
            Nationality: "IN",
            ContactNo: "9876543210",
            Email: "test@example.com",
            IsLeadPax: true
        }
    ]
};

// ==========================================
// LOGGER UTILITY
// ==========================================
const logs = [];

function logAndSave(step, endpoint, payload, response) {
    console.log(`\n=========================================`);
    console.log(`🚀 STEP: ${step}`);
    console.log(`➡️  ENDPOINT: ${endpoint}`);
    console.log(`✅ SUCCESS\n`);

    logs.push({
        timestamp: new Date().toISOString(),
        step,
        endpoint,
        payload,
        response
    });

    const logFilePath = path.join(__dirname, 'logs.json');
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
}

// ==========================================
// MAIN AUTOMATION FLOW
// ==========================================
async function runBookingAutomation() {
    console.log("Starting Automated Flight Booking Flow...");
    try {
        // ---------------------------------------------------------
        // 1. SEARCH
        // ---------------------------------------------------------
        console.log("\n1️⃣ Searching flights...");
        const searchUrl = `${CONFIG.baseUrl}/api/search`;
        const searchParams = new URLSearchParams(CONFIG.search).toString();

        const searchRes = await axios.get(`${searchUrl}?${searchParams}`);
        logAndSave("Search", searchUrl, CONFIG.search, searchRes.data);

        // Check if results exist
        if (!searchRes.data || searchRes.data.length === 0) {
            console.log("❌ No flights found for given routes and dates.");
            return;
        }

        console.log(`\n🔍 Searching for preferred airline: ${CONFIG.airlinePreference}...`);
        
        let matchingFlight = null;
        for (const flight of searchRes.data) {
            const outboundSegments = flight.flights?.outbound?.segments || [];
            
            // Check if any segment is operated by the preferred airline
            const hasPreferredAirline = outboundSegments.some(seg => seg.airlineCode === CONFIG.airlinePreference);
            
            if (hasPreferredAirline) {
                matchingFlight = flight;
                break;
            }
        }

        if (!matchingFlight) {
            console.log(`❌ No flights found for the preferred airline (${CONFIG.airlinePreference}). Booking aborted.`);
            return;
        }

        console.log(`✈️  Found ${CONFIG.airlinePreference} flight! Proceeding with Booking...`);

        const traceId = matchingFlight.searchId;
        const resultIndex = matchingFlight.resultIndex;
        const isLCC = matchingFlight.isLCC;

        console.log(`✅ TraceId: ${traceId}, ResultIndex: ${resultIndex}, isLCC: ${isLCC}`);

        // ---------------------------------------------------------
        // 2. FARE QUOTE
        // ---------------------------------------------------------
        console.log("\n2️⃣ Fetching Fare Quote...");
        const fareQuoteUrl = `${CONFIG.baseUrl}/flights/fare-quote`;
        const routePayload = { traceId, resultIndex };
        
        const fareQuoteRes = await axios.post(fareQuoteUrl, routePayload);
        logAndSave("Fare Quote", fareQuoteUrl, routePayload, fareQuoteRes.data);

        // Check for business error
        if (fareQuoteRes.data && fareQuoteRes.data.success === false) {
             console.log("❌ Fare Quote failed. Cannot proceed.");
             return;
        }

        // ---------------------------------------------------------
        // 3. SSR (Optional)
        // ---------------------------------------------------------
        if (CONFIG.includeSSR) {
            console.log("\n3️⃣ Fetching SSR...");
            const ssrUrl = `${CONFIG.baseUrl}/flights/ssr`;
            const ssrRes = await axios.post(ssrUrl, routePayload);
            logAndSave("SSR", ssrUrl, routePayload, ssrRes.data);
        } else {
            console.log("\n3️⃣ Skipping SSR step (includeSSR is false)...");
        }

        // ---------------------------------------------------------
        // 4. BOOK ROUTE
        // ---------------------------------------------------------
        console.log("\n4️⃣ Booking flight...");
        const bookUrl = `${CONFIG.baseUrl}/flights/book`;
        
        // Assemble Fare for Passengers from Fare Quote
        const fareData = fareQuoteRes.data.data.price;
        const mappedPassengers = CONFIG.passengers.map(pax => ({
            ...pax,
            Fare: {
                Currency: "INR",
                BaseFare: fareData.base,
                Tax: fareData.taxes,
                YQTax: 0,
                AdditionalTxnFeeOfrd: 0,
                AdditionalTxnFeePub: 0,
                OtherCharges: 0
            }
        }));

        const bookPayload = {
            isLCC,
            TraceId: traceId,
            ResultIndex: resultIndex,
            IsPriceChangeAccepted: true,
            Passengers: mappedPassengers
        };

        const bookRes = await axios.post(bookUrl, bookPayload);
        logAndSave("Book", bookUrl, bookPayload, bookRes.data);

        console.log(`\n🎉 Booking Flow Completed Successfully!`);
        console.log(`📄 All steps have been logged to logs.json`);

    } catch (error) {
        console.error("\n❌ ERROR DURING BOOKING FLOW:");
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
            logAndSave("Error", error.config.url, JSON.parse(error.config.data || '{}'), error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

runBookingAutomation();
