const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Auth Routes
router.get('/auth/google', authController.googleAuth);
router.get('/auth/google/callback', authController.googleCallback);
router.post('/auth/google/sync', authController.syncGoogleUser);
router.get('/api/auth/user', authController.getCurrentUser);
router.get('/api/auth/logout', authController.logout);

module.exports = router;
