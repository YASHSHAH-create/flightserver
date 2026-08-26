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
                process.env.JWT_SECRET,
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

        const normalizedEmail = email.toLowerCase().trim();

        // Search by googleId or email
        let user = await User.findOne({
            $or: [
                { googleId },
                { email: normalizedEmail }
            ]
        });

        if (!user) {
            // Create new user
            user = new User({
                googleId,
                email: normalizedEmail,
                name,
                picture,
                pushToken,
                expoPushToken: expoPushToken || pushToken
            });
            await user.save();
        } else {
            // Update existing (link googleId if missing/changed)
            if (user.googleId !== googleId) {
                user.googleId = googleId;
            }
            user.email = normalizedEmail;
            if (name) user.name = name;
            if (picture) user.picture = picture;
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

        // A device token belongs to exactly one account — strip it from other
        // user docs so broadcasts don't hit the same phone multiple times
        const deviceToken = user.expoPushToken || user.pushToken;
        if (deviceToken) {
            await User.updateMany(
                { _id: { $ne: user._id }, $or: [{ expoPushToken: deviceToken }, { pushToken: deviceToken }] },
                { $unset: { expoPushToken: 1, pushToken: 1 } }
            );
        }

        // Generate token
        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET,
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
