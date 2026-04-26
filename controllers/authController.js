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

const User = require('../models/User');

const syncGoogleUser = async (req, res) => {
    try {
        const { googleId, email, name, picture, pushToken, expoPushToken } = req.body;

        if (!googleId || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let user = await User.findOne({ googleId });

        if (!user) {
            // Create new user
            user = new User({
                googleId,
                email,
                name,
                picture,
                pushToken,
                expoPushToken: expoPushToken || pushToken
            });
            await user.save();
        } else {
            // Update existing (optional, but good for keeping profile fresh)
            user.email = email;
            user.name = name;
            user.picture = picture;
            if (pushToken) {
                user.pushToken = pushToken;
            }
            if (expoPushToken) {
                user.expoPushToken = expoPushToken;
            } else if (pushToken) {
                user.expoPushToken = pushToken;
            }
            await user.save();
        }

        // Generate token (optional, if we want to switch to backend-jwt later, but for now we just need the user DB record)
        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: '7d' }
        );

        res.json({ success: true, user, token });

    } catch (error) {
        console.error('Error syncing user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
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
    getCurrentUser,
    logout,
    syncGoogleUser
};
