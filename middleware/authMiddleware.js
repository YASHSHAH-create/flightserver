const tboService = require('../services/tboService');

const ensureToken = async (req, res, next) => {
    try {
        const token = await tboService.getToken();
        if (!token) {
            return res.status(500).json({ error: 'Failed to authenticate with flight API' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Authentication service error' });
    }
};

module.exports = { ensureToken };
