import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import * as analyticsController from '../controllers/analyticsController.js';

const router = Router();

// All routes require authentication
router.use(isAuthenticated);

/**
 * GET /api/analytics/overview
 * Get overview statistics
 */
router.get('/overview', analyticsController.getOverview);

/**
 * GET /api/analytics/time-series
 * Get views and leads over time
 * Query params: days (default 30)
 */
router.get('/time-series', analyticsController.getTimeSeries);

/**
 * GET /api/analytics/sources
 * Get traffic source breakdown
 */
router.get('/sources', analyticsController.getSourceBreakdown);

/**
 * GET /api/analytics/funnels
 * Get performance by funnel/lead magnet
 */
router.get('/funnels', analyticsController.getFunnelPerformance);

/**
 * GET /api/analytics/activity
 * Get recent activity feed
 * Query params: limit (default 20)
 */
router.get('/activity', analyticsController.getRecentActivity);

export default router;

