import { Router, Request, Response } from 'express';
import passport from 'passport';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { isAuthenticated } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

const router: Router = Router();

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

const updateBrandSettingsSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  fontFamily: z.string().min(1).max(100).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
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
router.get('/me', isAuthenticated, authController.getCurrentUser);

/**
 * PATCH /api/auth/profile
 * Update user profile
 */
router.patch('/profile', isAuthenticated, validateBody(updateProfileSchema), authController.updateProfile);

/**
 * PATCH /api/auth/brand-settings
 * Update user brand settings
 */
router.patch('/brand-settings', isAuthenticated, validateBody(updateBrandSettingsSchema), authController.updateBrandSettings);

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
  // prompt: 'select_account' forces Google to show account picker every time
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })(req, res, next);
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

/**
 * POST /api/auth/feedback
 * Submit feedback (authenticated users only)
 */
router.post('/feedback', isAuthenticated, authController.submitFeedback);

export default router;

