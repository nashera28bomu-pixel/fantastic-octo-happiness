// src/server.js
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { testDatabaseConnection } from './config/database.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import AuthService from './services/AuthService.js';
import logger from './utils/logger.js';

// Routes
import reportRoutes  from './routes/report.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import adminRoutes   from './routes/admin.routes.js';
import publicRoutes  from './routes/public.routes.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ---- SECURITY ----
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// ---- CORS ----
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ---- BODY PARSING ----
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---- COMPRESSION ----
app.use(compression());

// ---- LOGGING ----
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) }
  }));
}

// ---- RATE LIMITING ----
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  max:      parseInt(process.env.RATE_LIMIT_MAX || 100),
  message:  { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: 'Too many report requests. Please wait before trying again.' }
});

app.use('/api/', globalLimiter);
app.use('/api/v1/reports/initiate', reportLimiter);

// ---- TRUST PROXY (Render/Railway) ----
app.set('trust proxy', 1);

// ---- ROUTES ----
app.use('/api/v1/reports',   reportRoutes);
app.use('/api/v1/webhooks',  webhookRoutes);
app.use('/api/v1/admin',     adminRoutes);
app.use('/api/v1/public',    publicRoutes);

// ---- HEALTH CHECK ----
app.get('/health', async (req, res) => {
  const dbOk = await testDatabaseConnection();
  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? 'healthy' : 'degraded',
    service:   'Cymor KUCCPS Advisor API',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    database:  dbOk ? 'connected' : 'error'
  });
});

app.get('/', (req, res) => {
  res.json({ service: 'Cymor KUCCPS Advisor API', version: '1.0.0', status: 'running' });
});

// ---- ERROR HANDLERS ----
app.use(notFound);
app.use(errorHandler);

// ---- START ----
async function start() {
  try {
    logger.info('Starting Cymor KUCCPS Advisor API...');

    const dbOk = await testDatabaseConnection();
    if (!dbOk) {
      logger.warn('Database not connected — some features unavailable');
    }

    // Seed default admin if needed
    await AuthService.seedAdmin().catch(err =>
      logger.warn('Admin seed skipped', { error: err.message })
    );

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`Health: http://localhost:${PORT}/health`);
    });

  } catch (err) {
    logger.error('Server startup failed', { error: err.message });
    process.exit(1);
  }
}

start();

export default app;
