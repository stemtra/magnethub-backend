import * as Sentry from '@sentry/node';
import { config } from '../config/index.js';

// Initialize Sentry
export const initSentry = () => {
  if (config.isProd) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN || '',
      environment: config.nodeEnv,
      // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring
      tracesSampleRate: 0.1,
      // Ignore common non-actionable errors
      ignoreErrors: [
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
      ],
    });

    Sentry.setTag('app', 'magnethub-backend');
    Sentry.setTag('version', '1.0.0');
  }
};

// Set user context for error tracking
export const setSentryUser = (user: { id: string; email: string }) => {
  if (config.isProd) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
    });
  }
};

// Clear user context (on logout)
export const clearSentryUser = () => {
  if (config.isProd) {
    Sentry.setUser(null);
  }
};

// Capture an error
export const captureError = (err: unknown, context?: Record<string, unknown>) => {
  if (config.isProd && err) {
    if (context) {
      Sentry.setContext('additional', context);
    }
    Sentry.captureException(err);
  }
};

// Add breadcrumb for debugging
export const addBreadcrumb = (category: string, message: string, data?: Record<string, unknown>) => {
  if (config.isProd) {
    Sentry.addBreadcrumb({
      category,
      message,
      data,
      level: 'info',
    });
  }
};

// Capture a message (for non-error events)
export const captureMessage = (message: string, level: 'info' | 'warning' | 'error' = 'info') => {
  if (config.isProd) {
    Sentry.captureMessage(message, level);
  }
};

// Export Sentry for advanced use cases (like Express error handler)
export { Sentry };

