import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { validateBody, validateParams } from '../middleware/validate.js';
import { isAuthenticated } from '../middleware/auth.js';
import { checkGenerationLimit, requireBillingHealthy } from '../middleware/rateLimit.js';
import * as leadMagnetController from '../controllers/leadMagnetController.js';

const router = Router();

// ============================================
// Multer configuration for file uploads
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max (will be validated per type in controller)
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'audio/mpeg',
      'audio/mp3',
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed types: PDF, PNG, JPG, WebP, MP3'));
    }
  },
});

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

// New unified generation schema (topic-based)
const generateUnifiedSchema = z.object({
  brandId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid brand ID'),
  topic: z.string().min(3, 'Topic must be at least 3 characters').max(1500, 'Topic too long'),
  type: z.enum(['quiz', 'guide', 'checklist', 'mistakes', 'blueprint', 'swipefile', 'cheatsheet', 'casestudy', 'infographic']),
  // Quiz-specific fields
  numQuestions: z.number().int().min(3).max(20).optional(),
  numResults: z.number().int().min(2).max(8).optional(),
  // Infographic-specific fields
  infographicStyle: z.enum(['minimal', 'modern', 'bold', 'professional']).optional(),
  infographicOrientation: z.enum(['square', 'portrait', 'landscape']).optional(),
}).refine(
  (data) => {
    // If quiz, require numQuestions and numResults
    if (data.type === 'quiz') {
      return data.numQuestions !== undefined && data.numResults !== undefined;
    }
    return true;
  },
  {
    message: 'numQuestions and numResults are required for quiz type',
    path: ['type'],
  }
);

// ============================================
// Routes
// ============================================

// All routes require authentication
router.use(isAuthenticated);

/**
 * POST /api/lead-magnets/generate-unified
 * Generate a new lead magnet (unified topic-based flow)
 */
router.post('/generate-unified', requireBillingHealthy, checkGenerationLimit, validateBody(generateUnifiedSchema), leadMagnetController.generateUnified);

/**
 * POST /api/lead-magnets/generate
 * Generate a new lead magnet (legacy URL-based flow)
 */
router.post('/generate', requireBillingHealthy, checkGenerationLimit, validateBody(generateSchema), leadMagnetController.generate);

/**
 * POST /api/lead-magnets/upload
 * Upload a user's own media file as a lead magnet
 */
router.post('/upload', requireBillingHealthy, checkGenerationLimit, upload.single('file'), leadMagnetController.uploadMedia);

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
router.get('/leads/export', requireBillingHealthy, leadMagnetController.exportAllLeadsCsv);

/**
 * GET /api/lead-magnets/:id
 * Get a single lead magnet by ID
 */
router.get('/:id', validateParams(idParamSchema), leadMagnetController.getOne);

/**
 * PATCH /api/lead-magnets/:id
 * Update a lead magnet
 */
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
router.patch('/:id', validateParams(idParamSchema), validateBody(updateSchema), leadMagnetController.update);

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
router.get('/:id/leads/export', requireBillingHealthy, validateParams(idParamSchema), leadMagnetController.exportLeadsCsv);

/**
 * POST /api/lead-magnets/:id/regenerate-pdf
 * Regenerate the PDF for a lead magnet
 */
router.post('/:id/regenerate-pdf', requireBillingHealthy, validateParams(idParamSchema), leadMagnetController.regeneratePdf);

export default router;

