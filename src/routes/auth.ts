import { Router } from 'express';
import passport from 'passport';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { isAuthenticated } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import { config } from '../config/index.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username too long')
    .regex(/^[a-z0-9_-]+$/, 'Username can only contain lowercase letters, numbers, hyphens, and underscores')
    .optional(),
});

// ============================================
// Routes
// ============================================

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', validateBody(registerSchema), authController.register);

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', validateBody(loginSchema), authController.login);

/**
 * POST /api/auth/logout
 * Logout current user
 */
router.post('/logout', authController.logout);

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', authController.getCurrentUser);

/**
 * PATCH /api/auth/profile
 * Update user profile
 */
router.patch('/profile', isAuthenticated, validateBody(updateProfileSchema), authController.updateProfile);

/**
 * GET /api/auth/google
 * Initiate Google OAuth flow
 */
router.get('/google', (req, res, next) => {
  if (!config.google.clientId) {
    return res.status(501).json({
      success: false,
      error: 'Google OAuth is not configured',
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

/**
 * GET /api/auth/google/callback
 * Google OAuth callback
 */
router.get(
  '/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${config.clientUrl}/login?error=google_auth_failed` 
  }),
  authController.googleCallback
);

export default router;

