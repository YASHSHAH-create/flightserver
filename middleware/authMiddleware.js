const tboService = require('../services/tboService');

const ensureToken = async (req, res, next) => {
    try {
        const token = await tboService.getToken();
        console.log('Current Token ID:', token);
        if (!token) {
            return res.status(500).json({ error: 'Failed to authenticate with flight API' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Authentication service error' });
    }
};

module.exports = { ensureToken };
