import { Router } from 'express';
import express from 'express';
import * as publicController from '../controllers/publicController.js';

const router: Router = Router();

// Parse URL-encoded bodies (for form submissions)
router.use(express.urlencoded({ extended: true }));

/**
 * GET /public/:username/:slug
 * Serve the published landing page
 */
router.get('/:username/:slug', publicController.serveLandingPage);

/**
 * POST /public/:username/:slug/subscribe
 * Handle lead capture form submission (HTML form)
 */
router.post('/:username/:slug/subscribe', publicController.subscribe);

/**
 * POST /public/:username/:slug/subscribe-api
 * Handle lead capture via API (for AJAX submissions)
 */
router.post('/:username/:slug/subscribe-api', publicController.subscribeApi);

/**
 * GET /public/:username/:slug/thank-you
 * Show thank you page after form submission
 */
router.get('/:username/:slug/thank-you', publicController.thankYouPage);

export default router;

