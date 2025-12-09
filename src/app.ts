import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import path from 'path';

import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { getLocalPdfPath } from './services/storageService.js';

// Import passport configuration (this sets up strategies)
import passport from './config/passport.js';

// Import routes
import authRoutes from './routes/auth.js';
import brandRoutes from './routes/brands.js';
import leadMagnetRoutes from './routes/leadMagnets.js';
import publicRoutes from './routes/public.js';
import analyticsRoutes from './routes/analytics.js';
import billingRoutes from './routes/billing.js';
import sentryRoutes from './routes/sentry.js';

const app: express.Application = express();

// ============================================
// Security Middleware
// ============================================

app.use(helmet({
  contentSecurityPolicy: config.isProd ? undefined : false, // Disable in dev for easier debugging
  crossOriginEmbedderPolicy: false, // Allow embedding PDFs
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resource access
}));

// ============================================
// CORS
// ============================================

app.use(cors({
  origin: config.clientUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================
// Stripe Webhook (needs raw body - BEFORE json middleware)
// ============================================

app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// ============================================
// Body Parsing
// ============================================

// Skip JSON parsing for Stripe webhooks to preserve the raw body for signature verification
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') {
    return next();
  }
  return express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') {
    return next();
  }
  return express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// ============================================
// Logging
// ============================================

if (config.isDev) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message: string) => logger.info(message.trim()),
    },
  }));
}

// ============================================
// Session
// ============================================

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: config.mongoUri,
    ttl: 14 * 24 * 60 * 60, // 14 days
    autoRemove: 'native',
  }),
  cookie: {
    secure: config.isProd,
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    sameSite: config.isProd ? 'strict' : 'lax',
  },
}));

// ============================================
// Passport
// ============================================

app.use(passport.initialize());
app.use(passport.session());

// ============================================
// Health Check
// ============================================

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
    },
  });
});

// ============================================
// API Routes
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/lead-magnets', leadMagnetRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/sentry', sentryRoutes);

// Public routes (landing pages and lead capture)
app.use('/public', publicRoutes);

// API info route
app.get('/api', (_req, res) => {
  res.json({
    success: true,
    data: {
      message: 'MagnetHub API',
      version: '1.0.0',
    },
  });
});

// ============================================
// Serve Local PDFs (Development)
// ============================================

app.get('/api/pdfs/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // Security: prevent directory traversal
  const safeFilename = path.basename(filename);
  
  const filePath = await getLocalPdfPath(safeFilename);
  
  if (!filePath) {
    return res.status(404).json({
      success: false,
      error: 'PDF not found',
      code: 'NOT_FOUND',
    });
  }

  // Allow embedding in iframes from our client
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(filePath);
});

// ============================================
// 404 Handler
// ============================================

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'NOT_FOUND',
  });
});

// ============================================
// Error Handler
// ============================================

app.use(errorHandler);

export default app;

