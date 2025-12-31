import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { getSessionConfig, getCorsConfig } from './utils/config.js';

// Import passport configuration (this sets up strategies)
import passport from './config/passport.js';

// Import routes
import authRoutes from './routes/auth.js';
import brandRoutes from './routes/brands.js';
import leadMagnetRoutes from './routes/leadMagnets.js';
import quizRoutes from './routes/quizzes.js';
import publicRoutes from './routes/public.js';
import publicSubdomainRoutes from './routes/publicSubdomain.js';
import analyticsRoutes from './routes/analytics.js';
import billingRoutes from './routes/billing.js';
import sentryRoutes from './routes/sentry.js';
import exploreRoutes from './routes/explore.js';

const app: express.Application = express();

// ============================================
// Security Middleware
// ============================================

// Behind reverse proxies (e.g., Vercel/Load Balancers) we must trust the
// first proxy so req.secure reflects the original HTTPS request. Without this,
// secure cookies would not be set and sessions would fail.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: config.isProd ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://yt3.googleusercontent.com", "https://scontent.cdninstagram.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  } : false, // Disable in dev for easier debugging
  crossOriginEmbedderPolicy: false, // Allow embedding PDFs
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resource access
}));

// ============================================
// CORS
// ============================================

app.use(cors(getCorsConfig()));

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

app.use(session(getSessionConfig()));

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
app.use('/api/quizzes', quizRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/sentry', sentryRoutes);
app.use('/api/explore', exploreRoutes);

// Public routes (landing pages and lead capture)
app.use('/public', publicRoutes);
// Public routes on username subdomains: https://{username}.<PUBLIC_ROOT_DOMAIN>/{slug}
// Guarded router; it no-ops unless hostname matches a non-reserved subdomain.
app.use('/', publicSubdomainRoutes);

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

