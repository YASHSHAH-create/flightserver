const passport = require('passport');
const jwt = require('jsonwebtoken');

const googleAuth = (req, res, next) => {
    const state = req.query.state;
    const authenticator = passport.authenticate('google', { scope: ['profile', 'email'], state: state });
    authenticator(req, res, next);
};

const googleCallback = (req, res, next) => {
    passport.authenticate('google', { failureRedirect: '/login-failed' }, (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.redirect('/login-failed');

        req.logIn(user, (err) => {
            if (err) return next(err);

            const token = jwt.sign(
                { id: user._id, email: user.email },
                process.env.JWT_SECRET || 'secret_key',
                { expiresIn: '7d' }
            );

            const state = req.query.state;
            if (state) {
                const redirectUrl = `${state}${state.includes('?') ? '&' : '?'}token=${token}`;
                res.redirect(redirectUrl);
            } else {
                res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
            }
        });
    })(req, res, next);
};

const getCurrentUser = (req, res) => {
    res.json(req.user || null);
};

const logout = (req, res) => {
    req.logout((err) => {
        if (err) { return res.status(500).json({ error: 'Logout failed' }); }
        res.json({ message: 'Logged out' });
    });
};

module.exports = {
    googleAuth,
    googleCallback,
    getCurrentUser,
    logout
};
