require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo').default;
const connectDB = require('./config/db');
const configurePassport = require('./config/passport');
const routes = require('./routes'); // Automagically finds index.js

const app = express();
const PORT = process.env.PORT || 3001;

// Database Connection
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI || 'mongodb://localhost:27017/flight-app' }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 day
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
