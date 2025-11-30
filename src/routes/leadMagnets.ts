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

// Instagram username/URL validation pattern
const instagramPattern = /^(@?[a-zA-Z0-9._]{1,30}|https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?|https?:\/\/(www\.)?instagr\.am\/[a-zA-Z0-9._]+\/?)$/;

// YouTube channel/handle validation pattern
const youtubePattern = /^(@?[a-zA-Z0-9._-]{1,50}|https?:\/\/(www\.)?youtube\.com\/@[a-zA-Z0-9._-]+\/?|https?:\/\/(www\.)?youtube\.com\/channel\/[a-zA-Z0-9_-]+\/?|https?:\/\/(www\.)?youtube\.com\/c\/[a-zA-Z0-9._-]+\/?|https?:\/\/(www\.)?youtube\.com\/user\/[a-zA-Z0-9._-]+\/?)$/;

const generateSchema = z.object({
  // New fields for multi-source support
  sourceType: z.enum(['website', 'instagram', 'youtube']).optional().default('website'),
  sourceUrl: z.string().min(1, 'Please provide a URL or username').optional(),
  // Legacy field - still supported for backward compatibility
  websiteUrl: z.string().optional(),
  // Brand selection (optional - will auto-create if not provided)
  brandId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid brand ID').optional(),
  audience: z.string().max(500).optional(),
  goal: z.enum(['get_leads', 'sell_call', 'grow_list']),
  type: z.enum(['guide', 'checklist', 'mistakes', 'blueprint', 'swipefile', 'cheatsheet', 'casestudy']),
  tone: z.enum(['professional', 'friendly', 'expert', 'persuasive']),
}).refine(
  (data) => data.sourceUrl || data.websiteUrl,
  { message: 'Please provide a source URL', path: ['sourceUrl'] }
).refine(
  (data) => {
    const url = data.sourceUrl || data.websiteUrl || '';
    if (data.sourceType === 'instagram') {
      return instagramPattern.test(url);
    }
    if (data.sourceType === 'youtube') {
      return youtubePattern.test(url);
    }
    // For websites, just check it looks like a URL
    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Please provide a valid URL or username', path: ['sourceUrl'] }
);

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
 * GET /api/lead-magnets/leads
 * Get all leads across all lead magnets for the authenticated user
 */
router.get('/leads', leadMagnetController.getAllLeads);

/**
 * GET /api/lead-magnets/leads/export
 * Export all leads as CSV
 */
router.get('/leads/export', leadMagnetController.exportAllLeadsCsv);

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

