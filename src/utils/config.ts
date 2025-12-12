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
//
// Important: never throw on disallowed origins. Throwing causes an "Unhandled error"
// and a 500 response, which is confusing (and breaks public landing-page flows).
export const getCorsConfig = () => {
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
  const allowedHeaders = ['Content-Type', 'Authorization'];

  return (
    req: { path?: string; headers?: Record<string, unknown>; header?: (name: string) => string | undefined },
    callback: (err: Error | null, options?: { origin: boolean | string | RegExp | (string | RegExp)[]; credentials?: boolean; methods?: string[]; allowedHeaders?: string[] }) => void
  ) => {
    const origin =
      (typeof req.header === 'function' ? req.header('Origin') : undefined) ||
      (typeof (req.headers?.origin) === 'string' ? (req.headers?.origin as string) : undefined);

    const isApi = Boolean(req.path && req.path.startsWith('/api'));

    // Public routes (landing pages, lead capture, etc.): allow from anywhere.
    // These endpoints do not require cookies, so keep credentials disabled.
    if (!isApi) {
      return callback(null, {
        origin: true, // reflect request origin (incl. "null" when present)
        credentials: false,
        methods,
        allowedHeaders,
      });
    }

    // API routes: strict allowlist + credentials for cookie-based auth.
    // Allow requests with no origin (curl, server-to-server, same-origin navigations).
    if (!origin) {
      return callback(null, { origin: true, credentials: true, methods, allowedHeaders });
    }

    // Never allow "null" origin with credentials (can be a sandbox bypass vector).
    if (origin === 'null') {
      return callback(null, { origin: false, credentials: true, methods, allowedHeaders });
    }

    // Allowlisted origins
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, { origin: true, credentials: true, methods, allowedHeaders });
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
          return callback(null, { origin: true, credentials: true, methods, allowedHeaders });
        }
      } catch {
        // fall through to rejection
      }
    }

    // Disallow silently (browser will block). Do NOT throw.
    return callback(null, { origin: false, credentials: true, methods, allowedHeaders });
  };
};
