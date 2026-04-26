const axios = require('axios');
const User = require('../models/User');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Internal function to send chunks to Expo and handle invalid tokens
const sendPushNotificationsAsync = async (messages) => {
    // Expo allows max 100 messages per request
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < messages.length; i += chunkSize) {
        chunks.push(messages.slice(i, i + chunkSize));
    }

    // Process chunks asynchronously in the background so it doesn't block
    for (const chunk of chunks) {
        try {
            const response = await axios.post(EXPO_PUSH_URL, chunk, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                }
            });

            // Handle errors for invalid tokens (DeviceNotRegistered)
            const tickets = response.data.data;
            const invalidTokens = [];

            if (tickets && Array.isArray(tickets)) {
                tickets.forEach((ticket, index) => {
                    if (ticket.status === 'error') {
                        console.error(`[Push Error for ${chunk[index].to}]:`, ticket.message, ticket.details);
                        if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
                            invalidTokens.push(chunk[index].to);
                        }
                    }
                });
            }

            // Remove invalid tokens from DB
            if (invalidTokens.length > 0) {
                await User.updateMany(
                    { expoPushToken: { $in: invalidTokens } },
                    { $unset: { expoPushToken: 1 } }
                );
                console.log(`Cleaned up ${invalidTokens.length} invalid Expo push tokens.`);
            }
        } catch (error) {
            console.error('Error sending push notifications chunk:', error.message);
        }
    }
};

const saveToken = async (req, res) => {
    try {
        const { googleId, expoPushToken } = req.body;

        if (!googleId || !expoPushToken) {
            return res.status(400).json({ error: 'googleId and expoPushToken are required' });
        }

        const user = await User.findOne({ googleId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.expoPushToken = expoPushToken;
        await user.save();

        res.status(200).json({ message: 'Push token saved successfully' });
    } catch (error) {
        console.error('Error saving push token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const sendNotification = async (req, res) => {
    try {
        const { type, googleId, title, message } = req.body;

        if (!type || !title || !message) {
            return res.status(400).json({ error: 'type, title, and message are required' });
        }

        let pushTokens = [];

        if (type === 'single') {
            if (!googleId) {
                return res.status(400).json({ error: 'googleId is required for type "single"' });
            }
            const user = await User.findOne({ googleId });
            if (user && user.expoPushToken) {
                pushTokens.push(user.expoPushToken);
            } else {
                return res.status(404).json({ error: 'User not found or push token not available' });
            }
        } else if (type === 'all') {
            // Find users who have expoPushToken set
            const users = await User.find({ 
                expoPushToken: { $exists: true, $ne: null, $ne: '' } 
            });
            pushTokens = users.map(u => u.expoPushToken);
            if (pushTokens.length === 0) {
                return res.status(404).json({ error: 'No users found with valid push tokens' });
            }
        } else {
            return res.status(400).json({ error: 'Invalid type, must be "all" or "single"' });
        }

        const messages = pushTokens.map(token => ({
            to: token,
            sound: 'default',
            title,
            body: message
        }));

        // Send notifications asynchronously without blocking the response (fire and forget pattern)
        sendPushNotificationsAsync(messages).catch(console.error);

        res.status(200).json({ message: 'Notifications processing started successfully', count: messages.length });
    } catch (error) {
        console.error('Error in sendNotification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    saveToken,
    sendNotification
};
