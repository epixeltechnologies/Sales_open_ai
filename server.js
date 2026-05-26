require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { initializeSocket } = require('./socket/socketManager');
const { connectStore } = require('./config/memoryStore');
const { logger } = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Routes
const authRoutes        = require('./routes/auth');
const dashboardRoutes   = require('./routes/dashboard');
const leadsRoutes       = require('./routes/leads');
const agentRoutes       = require('./routes/agent');
const callRoutes        = require('./routes/calls');
const analyticsRoutes   = require('./routes/analytics');
const billingRoutes     = require('./routes/billing');
const appointmentRoutes = require('./routes/appointments');

const app    = express();
const server = http.createServer(app);

// Socket.io
const io = initializeSocket(server);
app.set('io', io);

// Security
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Raw body for Stripe webhooks; urlencoded for Twilio
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/call/webhook',    express.urlencoded({ extended: false }));
app.use('/api/call/status',     express.urlencoded({ extended: false }));
app.use('/api/call/gather',     express.urlencoded({ extended: false }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// Health check
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: 'SalesVoice AI', timestamp: new Date().toISOString() })
);

// API routes
app.use('/api/auth',         authRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/leads',        leadsRoutes);
app.use('/api/agent',        agentRoutes);
app.use('/api/call',         callRoutes);
app.use('/api/analytics',    analyticsRoutes);
app.use('/api/billing',      billingRoutes);
app.use('/api/appointments', appointmentRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

function startServer() {
  connectStore();          // initialise in-memory store
  server.listen(PORT, () => {
    logger.info(`🚀 SalesVoice AI running on port ${PORT}`);
    logger.info(`📡 Environment : ${process.env.NODE_ENV}`);
    logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
  });
}

startServer();

module.exports = { app, server };
