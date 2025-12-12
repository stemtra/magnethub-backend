import { Router } from 'express';
import express from 'express';
import { config } from '../config/index.js';
import * as publicController from '../controllers/publicController.js';

const router: Router = Router();

// Parse URL-encoded bodies (for form submissions)
router.use(express.urlencoded({ extended: true }));

function extractUsernameFromHostname(hostname: string): string | null {
  const root = (config.publicRootDomain || '').toLowerCase();
  if (!root) return null;

  const host = (hostname || '').toLowerCase();
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

// Guard: only handle requests on username subdomains of the public root domain.
router.use((req, _res, next) => {
  const username = extractUsernameFromHostname(req.hostname);
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
  // Map params to controller shape
  (req.params as Record<string, string>).slug = req.params.slug;
  return publicController.serveLandingPage(req, res, next);
});

/**
 * POST /:slug/subscribe
 * Handle lead capture form submission (HTML form)
 */
router.post('/:slug/subscribe', (req, res, next) => publicController.subscribe(req, res, next));

/**
 * POST /:slug/subscribe-api
 * Handle lead capture via API (for AJAX submissions)
 */
router.post('/:slug/subscribe-api', (req, res, next) => publicController.subscribeApi(req, res, next));

/**
 * GET /:slug/thank-you
 * Show thank you page after form submission
 */
router.get('/:slug/thank-you', (req, res, next) => publicController.thankYouPage(req, res, next));

export default router;


