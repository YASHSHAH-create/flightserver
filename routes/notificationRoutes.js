const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');

// POST /api/notifications/save-token
// Payload: { googleId: string, expoPushToken: string }
router.post('/api/notifications/save-token', notificationService.saveToken);

// POST /api/notifications/send
// Payload: { type: "all" | "single", googleId?: string, title: string, message: string }
router.post('/api/notifications/send', notificationService.sendNotification);

module.exports = router;
