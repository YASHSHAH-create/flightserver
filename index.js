require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo').default;
const connectDB = require('./config/db');
const configurePassport = require('./config/passport');
const routes = require('./routes'); // Automagically finds index.js
const cron = require('node-cron');
const { authenticate } = require('./services/tboService');
const { initBotPolling } = require('./services/telegramBot');

// Fail fast if signing secrets are missing — never fall back to a known literal
if (!process.env.JWT_SECRET || !process.env.SESSION_SECRET) {
    console.error('FATAL: JWT_SECRET and SESSION_SECRET must be set in the environment.');
    process.exit(1);
}

// Start telegram bot polling
initBotPolling();

// Schedule token refresh at 10 PM every day
cron.schedule('0 22 * * *', async () => {
    console.log('Running scheduled token refresh at 10 PM...');
    try {
        await authenticate();
        console.log('Token refreshed successfully.');
    } catch (error) {
        console.error('Error refreshing token:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});

// Schedule token refresh at 3 AM every day
cron.schedule('0 3 * * *', async () => {
    console.log('Running scheduled token refresh at 3 AM...');
    try {
        await authenticate();
        console.log('Token refreshed successfully.');
    } catch (error) {
        console.error('Error refreshing token:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});

// Function to calculate and log time remaining until next 10 PM IST
const logTimeUntilRefresh = () => {
    const now = new Date();

    // Get current time in IST
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });

    const parts = formatter.formatToParts(now);
    const dateParts = {};
    parts.forEach(({ type, value }) => { dateParts[type] = value; });

    // Construct a Date object treating the IST time as local time for calculation
    // Note: Month in Date constructor is 0-indexed if using arguments, but we are using string parsing or manual parts
    // safer to use arguments: new Date(year, monthIndex, day, hours, minutes, seconds)

    const nowIST = new Date(
        parseInt(dateParts.year),
        parseInt(dateParts.month) - 1,
        parseInt(dateParts.day),
        parseInt(dateParts.hour),
        parseInt(dateParts.minute),
        parseInt(dateParts.second)
    );

    // define scheduled times
    const scheduledHours = [3, 22];
    let nextRefreshTime = null;

    // Check today's scheduled times
    for (const h of scheduledHours) {
        let t = new Date(nowIST);
        t.setHours(h, 0, 0, 0);
        if (t > nowIST) {
            nextRefreshTime = t;
            break;
        }
    }

    // If no more refreshes today, pick the first one tomorrow
    if (!nextRefreshTime) {
        let t = new Date(nowIST);
        t.setDate(t.getDate() + 1);
        t.setHours(scheduledHours[0], 0, 0, 0);
        nextRefreshTime = t;
    }

    const diff = nextRefreshTime - nowIST;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    console.log(`[Token Refresh Timer] Time remaining untill token refresh: ${hours} hours and ${minutes} minutes`);
};

// Log immediately and then every minute
logTimeUntilRefresh();
setInterval(logTimeUntilRefresh, 60 * 1000);

const app = express();
const PORT = process.env.PORT || 3201;

// Database Connection
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/flight-app' }),
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Passport Config
configurePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// Global Request Logger
app.use((req, res, next) => {
    console.log(`[Global Logger] ${req.method} ${req.url} at ${new Date().toISOString()}`);
    next();
});

// Routes
app.use('/', routes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
