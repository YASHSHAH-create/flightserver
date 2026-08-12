/**
 * Internal service-to-service guard.
 *
 * Ticketing (`/flights/book`) and raw booking-details lookups must only be
 * triggered by our own payment server AFTER it has verified that money was
 * actually captured — never directly by a mobile client. We enforce that with
 * a shared secret that only the payment server holds.
 *
 * Requires INTERNAL_API_KEY to be set in the environment on BOTH servers.
 */
const requireInternalKey = (req, res, next) => {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected) {
        console.error('FATAL: INTERNAL_API_KEY not configured — refusing internal request.');
        return res.status(500).json({ error: 'Server not configured for internal requests' });
    }

    const provided = req.headers['x-internal-key'];
    if (!provided || provided !== expected) {
        return res.status(403).json({ error: 'Forbidden: internal access only' });
    }

    next();
};

module.exports = { requireInternalKey };
