import { Router } from 'express';
import { isAuthenticated } from '../middleware/auth.js';
import * as exploreController from '../controllers/exploreController.js';

const router = Router();

// ============================================
// Explore Routes (All require authentication)
// ============================================

// GET /api/explore/feed - Get public lead magnets and quizzes
router.get('/feed', isAuthenticated, exploreController.getExploreFeed);

export default router;

