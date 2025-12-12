import type { Request } from 'express';
import { Router } from 'express';
import express from 'express';
import { config } from '../config/index.js';
import * as publicController from '../controllers/publicController.js';

const router: Router = Router();

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
  const xfHost = req.headers['x-forwarded-host'];
  const hostHeader =
    typeof xfHost === 'string'
      ? xfHost
      : Array.isArray(xfHost)
        ? xfHost[0]
        : req.headers.host;

  const host = (hostHeader || '').split(',')[0]?.trim() || '';
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
  // Inject into params so existing controller logic can be reused.
  (req.params as Record<string, string>).username = username;
  return next();
});

/**
 * GET /:slug
 * Serve the published landing page on username subdomain
 */
router.get('/:slug', (req, res, next) => {
  if (!(req.params as Record<string, string>).username) return next();
  // Map params to controller shape
  (req.params as Record<string, string>).slug = req.params.slug;
  return publicController.serveLandingPage(req, res, next);
});

/**
 * POST /:slug/subscribe
 * Handle lead capture form submission (HTML form)
 */
router.post('/:slug/subscribe', (req, res, next) => {
  if (!(req.params as Record<string, string>).username) return next();
  return publicController.subscribe(req, res, next);
});

/**
 * POST /:slug/subscribe-api
 * Handle lead capture via API (for AJAX submissions)
 */
router.post('/:slug/subscribe-api', (req, res, next) => {
  if (!(req.params as Record<string, string>).username) return next();
  return publicController.subscribeApi(req, res, next);
});

/**
 * GET /:slug/thank-you
 * Show thank you page after form submission
 */
router.get('/:slug/thank-you', (req, res, next) => {
  if (!(req.params as Record<string, string>).username) return next();
  return publicController.thankYouPage(req, res, next);
});

export default router;


