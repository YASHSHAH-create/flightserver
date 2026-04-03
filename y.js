const axios = require('axios');

async function authenticateTBO() {
    const url = 'https://api.travelboutiqueonline.com/SharedAPI/SharedData.svc/rest/Authenticate';
    
    let myPublicIp = "Unknown";
    try {
        const ipResponse = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        myPublicIp = ipResponse.data.ip;
    } catch(err) {
        console.log("Unable to fetch public IP.");
    }
    
    const payloadIp = "13.202.144.95";
    
    console.log("=========================================");
    console.log("🔍 IP ADDRESS CHECK");
    console.log("=========================================");
    console.log("🌍 My Actual Public IP :", myPublicIp);
    console.log("📄 IP in API Payload   :", payloadIp);
    
    if (myPublicIp === payloadIp) {
        console.log("✅ RESULT: IPs MATCH. Sahi IP se request API tak jaa rahi hai.");
    } else {
        console.log("⚠️ RESULT: IPs DO NOT MATCH! Aap apni asli public IP API me nahi bhej rahe ho.");
        console.log("👉 Suggestion: TBO server (public) IP whitelist check karta hai. TBO team ko apna 'Actual Public IP' bhej kar whitelist karayein, aur payload me wohi IP bhejein.");
    }

    const requestPayload = {
        "ClientId": "tboprod",
        "UserName": "PATP475",
        "Password": "P@y@pi-47#5", 
        "EndUserIp": payloadIp
    };

    console.log("\n=========================================");
    console.log("🌐 API NAME: TBO (Tek Travels) Authenticate API");
    console.log("=========================================");
    console.log("➡️  REQUEST URL:", url);
    console.log("➡️  REQUEST METHOD: POST");
    console.log("➡️  REQUEST PAYLOAD:", JSON.stringify(requestPayload, null, 2));
    console.log("-----------------------------------------");
    console.log("⏳ Fetching data from API... Please wait.\n");

    try {
        const response = await axios.post(url, requestPayload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log("✅ RESPONSE STATUS:", response.status);
        console.log("✅ RESPONSE DATA:", JSON.stringify(response.data, null, 2));
        console.log("=========================================");
        
        if(response.data && response.data.TokenId) {
            console.log("🔑 Extracted Token ID:", response.data.TokenId);
            console.log("\nNote: Generate a single token in a day as it is valid for 24 hours (00:00 AM to 11:59 PM).");
        }
    } catch (error) {
        console.error("❌ ERROR RESPONSE:");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

authenticateTBO();
