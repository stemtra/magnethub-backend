import type { Request } from 'express';
import { Router } from 'express';
import express from 'express';
import { config } from '../config/index.js';
import * as publicController from '../controllers/publicController.js';
import * as publicQuizController from '../controllers/publicQuizController.js';
import { User } from '../models/User.js';

const router: Router = Router();

type PublicSubdomainRequest = Request & {
  _publicUsername?: string;
  _publicHostname?: string;
};

// Parse URL-encoded bodies (for form submissions)
router.use(express.urlencoded({ extended: true }));

function extractUsernameFromHostname(hostname: string): string | null {
  const rawRoot = String(config.publicRootDomain || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\.+/, '')
    .replace(/\/+$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (!rawRoot) return null;
  // Allow PUBLIC_ROOT_DOMAIN to be set either as a bare domain ("magnethubai.com")
  // or a full URL ("https://magnethubai.com").
  const root = (() => {
    try {
      if (rawRoot.startsWith('http://') || rawRoot.startsWith('https://')) {
        return new URL(rawRoot).hostname.replace(/^\.+/, '').replace(/\.+$/, '').toLowerCase();
      }
    } catch {
      // ignore
    }
    return rawRoot;
  })();

  const host = String(hostname || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (!host || host === root) return null;
  if (!host.endsWith(`.${root}`)) return null;

  // Example: "stefano.magnethubai.com" -> "stefano"
  const prefix = host.slice(0, -(root.length + 1));
  if (!prefix) return null;

  // If someone uses multi-level subdomains (a.b.magnethubai.com), take the most specific
  const username = prefix.split('.').pop() || '';
  if (!username) return null;

  if (config.publicReservedSubdomains.includes(username)) return null;
  return username;
}

function getOriginalHostname(req: Request): string {
  const pickFirst = (value: string | string[] | undefined): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] || '';
    return '';
  };

  // 1) Common proxy headers
  const xfHost = pickFirst(req.headers['x-forwarded-host']);
  const xoHost = pickFirst(req.headers['x-original-host']);

  // 2) RFC 7239 Forwarded: host=example.com;proto=https
  const forwarded = pickFirst(req.headers['forwarded']);
  const forwardedHostMatch = forwarded.match(/(?:^|;|\s)host="?([^;," ]+)"?/i);
  const fHost = forwardedHostMatch?.[1] || '';

  // 3) Fallback to Host
  const hostHeader = xfHost || xoHost || fHost || (req.headers.host || '');

  const host = String(hostHeader).split(',')[0]?.trim() || '';
  // Strip port if present (e.g. "example.com:443")
  return host.replace(/:\d+$/, '');
}

router.get('/__debug/host', (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!config.publicDebugKey || key !== config.publicDebugKey) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }

  const hostname = getOriginalHostname(req) || req.hostname;
  const username = extractUsernameFromHostname(hostname);

  return res.json({
    success: true,
    data: {
      effective: {
        hostname,
        extractedUsername: username,
        publicRootDomain: config.publicRootDomain,
        publicReservedSubdomainsCount: config.publicReservedSubdomains.length,
      },
      internal: {
        storedUsername: (req as PublicSubdomainRequest)._publicUsername,
        storedHostname: (req as PublicSubdomainRequest)._publicHostname,
      },
      express: {
        hostname: req.hostname,
        protocol: req.protocol,
        secure: req.secure,
        ip: req.ip,
      },
      headers: {
        host: req.headers.host,
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
      },
    },
  });
});

// Guard: only handle requests on username subdomains of the public root domain.
router.use((req, _res, next) => {
  // Prefer original host forwarded by proxies/CDN/edge.
  const hostname = getOriginalHostname(req) || req.hostname;
  const username = extractUsernameFromHostname(hostname);
  if (!username) return next();
  // NOTE: don't write to req.params here. Express overwrites req.params during route matching.
  // Store on the request instead, then copy into params inside each route handler.
  (req as PublicSubdomainRequest)._publicUsername = username;
  (req as PublicSubdomainRequest)._publicHostname = hostname;
  return next();
});

// Middleware: Validate that the username exists, redirect if not
router.use(async (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();

  // Skip validation for debug endpoint
  if (req.path.startsWith('/__debug')) return next();

  try {
    // Check if user exists
    const user = await User.findOne({ username: username.toLowerCase() }).select('_id');
    if (!user) {
      // User doesn't exist, redirect to main site
      return res.redirect(302, 'https://magnethubai.com');
    }
    return next();
  } catch (err) {
    // On error, just continue (better than breaking the site)
    return next();
  }
});

// ============================================
// Tenant Validation
// ============================================

/**
 * GET /tenant/validate
 * Validate that the current subdomain tenant exists
 */
router.get('/tenant/validate', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).slug = username;
  return publicController.getTenantBySlug(req, res, next);
});

// ============================================
// Quiz Routes (must be before :slug to avoid conflicts)
// ============================================

/**
 * GET /quiz/:slug
 * Get published quiz data (JSON for frontend rendering)
 */
router.get('/quiz/:slug', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicQuizController.getQuiz(req, res, next);
});

/**
 * POST /quiz/:slug/start
 * Record quiz start and get session ID
 */
router.post('/quiz/:slug/start', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicQuizController.startQuiz(req, res, next);
});

/**
 * POST /quiz/:slug/submit
 * Submit quiz answers and email, get result
 */
router.post('/quiz/:slug/submit', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicQuizController.submitQuiz(req, res, next);
});

// ============================================
// Lead Magnet Routes
// ============================================

/**
 * GET /:slug/data
 * Get lead magnet landing page data as JSON (for frontend rendering)
 */
router.get('/:slug/data', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicController.getLandingPageData(req, res, next);
});

/**
 * GET /:slug
 * Serve the published landing page on username subdomain (legacy HTML rendering)
 */
router.get('/:slug', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicController.serveLandingPage(req, res, next);
});

/**
 * POST /:slug/subscribe
 * Handle lead capture form submission (HTML form)
 */
router.post('/:slug/subscribe', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicController.subscribe(req, res, next);
});

/**
 * POST /:slug/subscribe-api
 * Handle lead capture via API (for AJAX submissions)
 */
router.post('/:slug/subscribe-api', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicController.subscribeApi(req, res, next);
});

/**
 * GET /:slug/thank-you
 * Show thank you page after form submission
 */
router.get('/:slug/thank-you', (req, res, next) => {
  const username = (req as PublicSubdomainRequest)._publicUsername;
  if (!username) return next();
  (req.params as Record<string, string>).username = username;
  return publicController.thankYouPage(req, res, next);
});

/**
 * Catch-all: if we reach here, user exists but the route/slug doesn't
 * Redirect to main site instead of showing JSON error
 */
router.use((_req, res) => {
  return res.redirect(302, 'https://magnethubai.com');
});

export default router;


