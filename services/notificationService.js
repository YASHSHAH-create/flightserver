const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
// optionally providing an access token if you have enabled push security
const expo = new Expo();

/**
 * Send a push notification to a specific push token.
 * @param {string} pushToken - The Expo push token (e.g., ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx])
 * @param {string} title - The title of the notification
 * @param {string} body - The body text of the notification
 * @param {object} data - Optional data JSON object
 */
const sendPushNotification = async (pushToken, title, body, data = {}) => {
    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`Push token ${pushToken} is not a valid Expo push token`);
        return;
    }

    const messages = [];
    messages.push({
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
    });

    // The Expo push notification service accepts batches of notifications so
    // that you don't need to send 1000 requests to send 1000 notifications.
    // We recommend you batch your notifications to reduce the number of
    // and to compress them (notifications with similar content will get
    // compressed).
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            console.log('Notification Ticket Chunk:', ticketChunk);
            tickets.push(...ticketChunk);
        } catch (error) {
            console.error('Error sending push notification chunk:', error);
        }
    }

    return tickets;
};

module.exports = {
    sendPushNotification
};
