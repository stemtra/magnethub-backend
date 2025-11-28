import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '../middleware/validate.js';
import { isAuthenticated } from '../middleware/auth.js';
import { checkGenerationLimit } from '../middleware/rateLimit.js';
import * as leadMagnetController from '../controllers/leadMagnetController.js';

const router = Router();

// ============================================
// Validation Schemas
// ============================================

const generateSchema = z.object({
  websiteUrl: z.string().url('Please provide a valid URL'),
  audience: z.string().max(500).optional(),
  goal: z.enum(['get_leads', 'sell_call', 'grow_list']),
  type: z.enum(['guide', 'checklist', 'mistakes', 'blueprint']),
  tone: z.enum(['professional', 'friendly', 'expert', 'persuasive']),
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
 * POST /api/lead-magnets/generate
 * Generate a new lead magnet
 */
router.post(
  '/generate',
  checkGenerationLimit,
  validateBody(generateSchema),
  leadMagnetController.generate
);

/**
 * GET /api/lead-magnets
 * Get all lead magnets for the authenticated user
 */
router.get('/', leadMagnetController.getAll);

/**
 * GET /api/lead-magnets/:id
 * Get a single lead magnet by ID
 */
router.get('/:id', validateParams(idParamSchema), leadMagnetController.getOne);

/**
 * DELETE /api/lead-magnets/:id
 * Delete a lead magnet
 */
router.delete('/:id', validateParams(idParamSchema), leadMagnetController.remove);

/**
 * GET /api/lead-magnets/:id/leads
 * Get all leads for a lead magnet
 */
router.get('/:id/leads', validateParams(idParamSchema), leadMagnetController.getLeads);

/**
 * GET /api/lead-magnets/:id/leads/export
 * Export leads as CSV
 */
router.get('/:id/leads/export', validateParams(idParamSchema), leadMagnetController.exportLeadsCsv);

/**
 * POST /api/lead-magnets/:id/regenerate-pdf
 * Regenerate the PDF for a lead magnet
 */
router.post('/:id/regenerate-pdf', validateParams(idParamSchema), leadMagnetController.regeneratePdf);

export default router;

