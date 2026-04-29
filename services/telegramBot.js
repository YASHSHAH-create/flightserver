const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SUBSCRIBERS_FILE = path.join(__dirname, '../telegram_subscribers.json');

// Initialize the file if it doesn't exist
if (!fs.existsSync(SUBSCRIBERS_FILE)) {
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify([]));
}

const getSubscribers = () => {
    try {
        const data = fs.readFileSync(SUBSCRIBERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
};

const saveSubscriber = (chatId) => {
    const subscribers = getSubscribers();
    // Convert to string to avoid mismatches
    const idStr = chatId.toString();
    if (!subscribers.includes(idStr)) {
        subscribers.push(idStr);
        fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
        console.log(`[Telegram Bot] New subscriber added: ${chatId}`);
    }
};

let lastUpdateId = 0;

const pollTelegramUpdates = async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    try {
        const response = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
            params: { offset: lastUpdateId + 1, timeout: 5 } // 5 second long-polling
        });

        if (response.data && response.data.ok) {
            const updates = response.data.result;
            for (const update of updates) {
                lastUpdateId = update.update_id;
                
                // If someone sends /start or just messages the bot, store their Chat ID
                if (update.message) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || '';
                    
                    if (text === '/start') {
                        saveSubscriber(chatId);
                        
                        // Send a welcome message
                        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                            chat_id: chatId,
                            text: '✅ Welcome! Aapka ID save ho gaya hai. Ab aapko sari flight booking notifications yaha milengi.'
                        }).catch(err => console.error('Error sending welcome msg:', err.message));
                    }
                }
            }
        }
    } catch (error) {
        // Ignore timeout/network errors to prevent console spam
    }
};

const initBotPolling = () => {
    console.log('[Telegram Bot] Started polling for /start messages...');
    // Initial call
    pollTelegramUpdates();
    // Poll every 3 seconds
    setInterval(pollTelegramUpdates, 3000);
};

module.exports = {
    initBotPolling,
    getSubscribers
};
