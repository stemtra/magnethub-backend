import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '../middleware/validate.js';
import { isAuthenticated } from '../middleware/auth.js';
import * as brandController from '../controllers/brandController.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const brandSettingsSchema = z.object({
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  fontFamily: z.string().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  landingPageTemplate: z.enum(['minimal', 'bold', 'split', 'classic']).optional(),
}).optional();

const createBrandSchema = z.object({
  name: z.string().min(1, 'Brand name is required').max(100),
  sourceType: z.enum(['website', 'instagram', 'youtube']),
  sourceUrl: z.string().min(1, 'Source URL is required'),
  settings: brandSettingsSchema,
  isDefault: z.boolean().optional(),
});

const updateBrandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sourceUrl: z.string().min(1).optional(),
  settings: brandSettingsSchema,
  isDefault: z.boolean().optional(),
});

const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
});

// ============================================
// Routes
// ============================================

// All routes require authentication
router.use(isAuthenticated);

/**
 * GET /api/brands
 * Get all brands for the authenticated user
 */
router.get('/', brandController.getAll);

/**
 * POST /api/brands
 * Create a new brand
 */
router.post(
  '/',
  validateBody(createBrandSchema),
  brandController.create
);

/**
 * GET /api/brands/:id
 * Get a single brand by ID
 */
router.get('/:id', validateParams(idParamSchema), brandController.getOne);

/**
 * PATCH /api/brands/:id
 * Update a brand
 */
router.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateBrandSchema),
  brandController.update
);

/**
 * DELETE /api/brands/:id
 * Delete a brand
 */
router.delete('/:id', validateParams(idParamSchema), brandController.remove);

/**
 * POST /api/brands/:id/set-default
 * Set a brand as the default
 */
router.post('/:id/set-default', validateParams(idParamSchema), brandController.setDefault);

export default router;

