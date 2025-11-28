import type { Response, NextFunction } from 'express';
import slugify from 'slugify';
import { v4 as uuidv4 } from 'uuid';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { runFullPipeline } from '../services/aiService.js';
import { generatePdf } from '../services/pdfService.js';
import { uploadPdf, isStorageConfigured } from '../services/storageService.js';
import { getRemainingGenerations } from '../middleware/rateLimit.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, ILeadMagnet } from '../types/index.js';

// ============================================
// Generate Lead Magnet
// ============================================

export async function generate(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnet: ILeadMagnet }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { websiteUrl, audience, goal, type, tone } = req.body;

    logger.info('Starting lead magnet generation', {
      userId: req.user._id,
      url: websiteUrl,
      type,
    });

    // Generate a unique slug
    const baseSlug = slugify(new URL(websiteUrl).hostname.replace('www.', ''), {
      lower: true,
      strict: true,
    });
    let slug = baseSlug;
    let counter = 1;

    // Ensure slug is unique for this user
    while (await LeadMagnet.findOne({ userId: req.user._id, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Run the AI pipeline
    const pipelineResult = await runFullPipeline(websiteUrl, {
      audience,
      type,
      tone,
      goal,
      username: req.user.username,
      slug,
    });

    // Generate PDF
    const pdfBuffer = await generatePdf(pipelineResult.content, type);

    // Upload PDF to storage (or use placeholder in dev)
    let pdfUrl = '';
    if (isStorageConfigured()) {
      const filename = `pdfs/${req.user._id}/${slug}-${uuidv4().slice(0, 8)}.pdf`;
      pdfUrl = await uploadPdf(pdfBuffer, filename);
    } else {
      logger.warn('Storage not configured, PDF not uploaded');
      pdfUrl = `/api/lead-magnets/pdf-placeholder/${slug}`;
    }

    // Update email sequence with actual PDF URL
    if (pipelineResult.emails.emails[0]) {
      pipelineResult.emails.emails[0].body_html = 
        pipelineResult.emails.emails[0].body_html.replace('{{PDF_URL}}', pdfUrl);
      pipelineResult.emails.emails[0].body_text = 
        pipelineResult.emails.emails[0].body_text.replace('{{PDF_URL}}', pdfUrl);
    }

    // Create lead magnet record
    const leadMagnet = await LeadMagnet.create({
      userId: req.user._id,
      websiteUrl,
      audience,
      goal,
      type,
      tone,
      title: pipelineResult.content.title,
      pdfUrl,
      landingPageHtml: pipelineResult.landingPage.html,
      emailsJson: pipelineResult.emails,
      outlineJson: pipelineResult.outline,
      metaJson: pipelineResult.meta,
      contentJson: pipelineResult.content,
      slug,
      isPublished: true,
    });

    logger.info('Lead magnet generated successfully', {
      userId: req.user._id,
      leadMagnetId: leadMagnet._id,
      slug,
    });

    res.status(201).json({
      success: true,
      data: { leadMagnet },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get All Lead Magnets for User
// ============================================

export async function getAll(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnets: ILeadMagnet[]; remaining: number }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('leadCount');

    const remaining = await getRemainingGenerations(req.user._id.toString());

    res.json({
      success: true,
      data: { leadMagnets, remaining },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Single Lead Magnet
// ============================================

export async function getOne(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnet: ILeadMagnet }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    }).populate('leadCount');

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    res.json({
      success: true,
      data: { leadMagnet },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Delete Lead Magnet
// ============================================

export async function remove(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    // Delete associated leads
    await Lead.deleteMany({ leadMagnetId: id });

    // Delete the lead magnet
    await leadMagnet.deleteOne();

    logger.info('Lead magnet deleted', {
      userId: req.user._id,
      leadMagnetId: id,
    });

    res.json({
      success: true,
      data: { message: 'Lead magnet deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Leads for Lead Magnet
// ============================================

export async function getLeads(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leads: typeof Lead[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    // Verify ownership
    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    const leads = await Lead.find({ leadMagnetId: id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { leads: leads as unknown as typeof Lead[] },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Export Leads as CSV
// ============================================

export async function exportLeadsCsv(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    // Verify ownership
    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    const leads = await Lead.find({ leadMagnetId: id })
      .sort({ createdAt: -1 });

    // Generate CSV
    const csvHeader = 'email,captured_at,delivery_status\n';
    const csvRows = leads.map(lead => 
      `${lead.email},${lead.createdAt.toISOString()},${lead.deliveryStatus}`
    ).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${leadMagnet.slug}-leads.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
}

// ============================================
// Regenerate PDF
// ============================================

export async function regeneratePdf(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ pdfUrl: string }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    if (!leadMagnet.contentJson) {
      throw AppError.badRequest('No content available for PDF regeneration');
    }

    // Regenerate PDF
    const pdfBuffer = await generatePdf(leadMagnet.contentJson, leadMagnet.type);

    // Upload new PDF
    let pdfUrl = leadMagnet.pdfUrl || '';
    if (isStorageConfigured()) {
      const filename = `pdfs/${req.user._id}/${leadMagnet.slug}-${uuidv4().slice(0, 8)}.pdf`;
      pdfUrl = await uploadPdf(pdfBuffer, filename);
      leadMagnet.pdfUrl = pdfUrl;
      await leadMagnet.save();
    }

    res.json({
      success: true,
      data: { pdfUrl },
    });
  } catch (error) {
    next(error);
  }
}

