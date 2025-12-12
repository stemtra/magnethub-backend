import MongoStore from 'connect-mongo';
import type { SessionOptions } from 'express-session';
import { config } from '../config/index.js';

function computeCookieDomain(): string | undefined {
  if (!config.isProd) return undefined;
  try {
    const hostname = new URL(config.clientUrl).hostname;
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return `.${parts.slice(-2).join('.')}`;
    }
  } catch {
    // fall back to default scoping
  }
  return undefined;
}

export function getSessionConfig(): SessionOptions {
  return {
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
      sameSite: 'lax',
      domain: computeCookieDomain(),
    },
  };
}

// CORS configuration helper (mirrors VisibleLLM pattern)
export const getCorsConfig = () => ({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (e.g., OAuth redirects, curl).
    if (!origin) return callback(null, true);

    // Allowlisted origins
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // In development, allow localhost variants for convenience
    if (config.isDev) {
      try {
        const url = new URL(origin);
        if (
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1' ||
          url.hostname.endsWith('.localhost')
        ) {
          return callback(null, true);
        }
      } catch {
        // fall through to rejection
      }
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
