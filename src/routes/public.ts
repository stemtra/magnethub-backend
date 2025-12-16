import { Router } from 'express';
import express from 'express';
import * as publicController from '../controllers/publicController.js';
import * as publicQuizController from '../controllers/publicQuizController.js';
import { quizSubmitLimiter } from '../middleware/rateLimiter.js';

const router: Router = Router();

// Parse URL-encoded bodies (for form submissions)
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

/**
 * Quiz routes (must come before generic :slug routes)
 */

// GET /public/:username/quiz/:slug - Get published quiz data
router.get('/:username/quiz/:slug', publicQuizController.getQuiz);

// POST /public/:username/quiz/:slug/start - Record quiz start
router.post('/:username/quiz/:slug/start', publicQuizController.startQuiz);

// POST /public/:username/quiz/:slug/submit - Submit quiz
router.post('/:username/quiz/:slug/submit', quizSubmitLimiter, publicQuizController.submitQuiz);

/**
 * GET /public/:username/:slug/data
 * Get lead magnet landing page data as JSON (for frontend rendering)
 */
router.get('/:username/:slug/data', publicController.getLandingPageData);

/**
 * GET /public/:username/:slug
 * Serve the published landing page (legacy HTML rendering)
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

