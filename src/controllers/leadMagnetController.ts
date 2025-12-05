import type { Response, NextFunction } from 'express';
import slugify from 'slugify';
import { v4 as uuidv4 } from 'uuid';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { Brand } from '../models/Brand.js';
import { runFullPipeline } from '../services/aiService.js';
import { generatePdf } from '../services/pdfService.js';
import { uploadPdf } from '../services/storageService.js';
import { renderLandingPage } from '../services/templateService.js';
import { getRemainingGenerations } from '../middleware/rateLimit.js';
import { billingService } from '../services/billingService.js';
import { isInstagramUrl, extractUsername, normalizeInstagramUrl } from '../services/instagramService.js';
import { isYouTubeUrl, extractYouTubeHandle, normalizeYouTubeUrl } from '../services/youtubeService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, ILeadMagnet, IBrandSettings, SourceType, IBrand } from '../types/index.js';

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

    // Support both old websiteUrl and new sourceUrl field
    const inputUrl = req.body.sourceUrl || req.body.websiteUrl;
    const { audience, goal, type, tone, brandId } = req.body;
    
    // Auto-detect source type if not provided
    let sourceType: SourceType = req.body.sourceType || 'website';
    if (!req.body.sourceType) {
      if (isYouTubeUrl(inputUrl)) {
        sourceType = 'youtube';
      } else if (isInstagramUrl(inputUrl)) {
        sourceType = 'instagram';
      }
    }
    
    // Normalize the URL based on source type
    let sourceUrl = inputUrl;
    if (sourceType === 'instagram') {
      sourceUrl = normalizeInstagramUrl(inputUrl);
    } else if (sourceType === 'youtube') {
      sourceUrl = normalizeYouTubeUrl(inputUrl);
    }

    logger.info('Starting lead magnet generation', {
      userId: req.user._id,
      sourceUrl,
      sourceType,
      type,
      brandId: brandId || 'auto',
    });

    // Generate a unique slug based on source type
    let baseSlug: string;
    let brandName: string;
    if (sourceType === 'instagram') {
      const username = extractUsername(inputUrl);
      baseSlug = slugify(username, { lower: true, strict: true });
      brandName = `@${username}`;
    } else if (sourceType === 'youtube') {
      const ytHandle = extractYouTubeHandle(inputUrl);
      const channelName = ytHandle?.value || 'youtube-channel';
      baseSlug = slugify(channelName, { lower: true, strict: true });
      brandName = ytHandle?.type === 'handle' ? `@${channelName}` : channelName;
    } else {
      const hostname = new URL(sourceUrl).hostname.replace('www.', '');
      baseSlug = slugify(hostname, { lower: true, strict: true });
      brandName = hostname;
    }
    
    let slug = baseSlug;
    let counter = 1;

    // Ensure slug is unique for this user
    while (await LeadMagnet.findOne({ userId: req.user._id, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // ============================================
    // Brand Management (Multi-Brand Support)
    // ============================================
    
    let brand: IBrand | null = null;
    let brandToUse: IBrandSettings | null = null;
    let useCachedData = false;

    if (brandId) {
      // User specified a brand - use it
      brand = await Brand.findOne({ _id: brandId, userId: req.user._id });
      if (!brand) {
        throw AppError.badRequest('Selected brand not found');
      }
      brandToUse = brand.settings;
      useCachedData = !!brand.description; // Use cache if we have description
      logger.info('Using specified brand', { 
        brandId: brand._id, 
        brandName: brand.name,
        hasCache: useCachedData,
      });
    } else {
      // Find existing brand based on source URL
      brand = await Brand.findOne({ userId: req.user._id, sourceUrl });
      
      if (brand) {
        // Existing brand found - use its settings
        brandToUse = brand.settings;
        useCachedData = !!brand.description; // Use cache if we have description
        logger.info('Using existing brand for source', { 
          brandId: brand._id, 
          brandName: brand.name,
          hasCache: useCachedData,
        });
      }
    }

    // Run the AI pipeline (skip scraping if we have cached brand data)
    const pipelineResult = await runFullPipeline(sourceUrl, {
      audience,
      type,
      tone,
      goal,
      sourceType,
      cachedData: useCachedData && brand?.description ? {
        description: brand.description,
        logoUrl: brand.settings.logoUrl,
        brandSettings: brand.settings,
      } : undefined,
    });

    // Create brand if it doesn't exist
    if (!brand) {
      const brandSettings: IBrandSettings = { ...pipelineResult.extractedBrand };
      
      // For Instagram, use profile picture as logo
      if (sourceType === 'instagram' && pipelineResult.instagramProfilePic) {
        brandSettings.logoUrl = pipelineResult.instagramProfilePic;
      }
      
      // For YouTube, use channel thumbnail as logo
      if (sourceType === 'youtube' && pipelineResult.youtubeThumbnail) {
        brandSettings.logoUrl = pipelineResult.youtubeThumbnail;
      }
      
      // Check if this is the first brand
      const brandCount = await Brand.countDocuments({ userId: req.user._id });
      
      brand = await Brand.create({
        userId: req.user._id,
        name: brandName,
        description: pipelineResult.sourceDescription,
        sourceType,
        sourceUrl,
        settings: brandSettings,
        isDefault: brandCount === 0, // First brand is default
      });
      
      brandToUse = brandSettings;
      logger.info('Created new brand from source', { 
        brandId: brand._id, 
        brandName: brand.name,
        sourceType,
        hasLogo: !!brandSettings.logoUrl,
        hasDescription: !!pipelineResult.sourceDescription,
      });
    } else if (!brand.description && pipelineResult.sourceDescription) {
      // Update existing brand with description if missing
      brand.description = pipelineResult.sourceDescription;
      await brand.save();
      logger.info('Updated brand with description', { brandId: brand._id });
    }

    // Render landing page HTML using template + brand + copy
    const formAction = `/public/${req.user.username}/${slug}/subscribe`;
    const finalBrandSettings = brandToUse || brand!.settings;
    const landingPageHtml = await renderLandingPage(
      finalBrandSettings,
      pipelineResult.landingPageCopy,
      formAction
    );

    // Generate PDF with brand settings
    const pdfBuffer = await generatePdf(pipelineResult.content, type, finalBrandSettings, brand!.name);

    // Upload PDF to storage (local or cloud)
    const filename = `pdfs/${req.user._id}/${slug}-${uuidv4().slice(0, 8)}.pdf`;
    const pdfUrl = await uploadPdf(pdfBuffer, filename);

    // Update email sequence with actual PDF URL
    if (pipelineResult.emails.emails[0]) {
      pipelineResult.emails.emails[0].body_html = 
        pipelineResult.emails.emails[0].body_html.replace('{{PDF_URL}}', pdfUrl);
      pipelineResult.emails.emails[0].body_text = 
        pipelineResult.emails.emails[0].body_text.replace('{{PDF_URL}}', pdfUrl);
    }

    // Create lead magnet record with brand reference
    const leadMagnet = await LeadMagnet.create({
      userId: req.user._id,
      brandId: brand._id,
      sourceType,
      sourceUrl,
      websiteUrl: sourceType === 'website' ? sourceUrl : undefined, // backward compatibility
      audience,
      goal,
      type,
      tone,
      title: pipelineResult.content.title,
      pdfUrl,
      landingPageHtml,
      landingPageCopyJson: pipelineResult.landingPageCopy,
      emailsJson: pipelineResult.emails,
      outlineJson: pipelineResult.outline,
      metaJson: pipelineResult.meta,
      contentJson: pipelineResult.content,
      slug,
      isPublished: true,
    });

    // Record usage for billing
    await billingService.recordLeadMagnetUsage(req.user._id.toString());

    logger.info('Lead magnet generated successfully', {
      userId: req.user._id,
      leadMagnetId: leadMagnet._id,
      brandId: brand._id,
      slug,
      sourceType,
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
// Get All Leads for User (across all lead magnets)
// ============================================

interface LeadWithMagnet {
  id: string;
  email: string;
  leadMagnetId: string;
  deliveryStatus: 'pending' | 'sent' | 'failed';
  createdAt: Date;
  leadMagnet?: {
    id: string;
    title: string;
    slug: string;
    type: string;
  };
}

export async function getAllLeads(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leads: LeadWithMagnet[]; total: number }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // Get all lead magnets for this user
    const userLeadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id title slug type');
    const leadMagnetIds = userLeadMagnets.map(lm => lm._id);

    // Get all leads for these lead magnets
    const leads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 });

    // Create a map for quick lookup
    const magnetMap = new Map(userLeadMagnets.map(lm => [lm._id.toString(), {
      id: lm._id.toString(),
      title: lm.title || 'Untitled',
      slug: lm.slug,
      type: lm.type,
    }]));

    // Enrich leads with lead magnet info
    const enrichedLeads: LeadWithMagnet[] = leads.map(lead => ({
      id: lead._id.toString(),
      email: lead.email,
      leadMagnetId: lead.leadMagnetId.toString(),
      deliveryStatus: lead.deliveryStatus,
      createdAt: lead.createdAt,
      leadMagnet: magnetMap.get(lead.leadMagnetId.toString()),
    }));

    res.json({
      success: true,
      data: { leads: enrichedLeads, total: enrichedLeads.length },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Export All Leads as CSV
// ============================================

export async function exportAllLeadsCsv(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // Get all lead magnets for this user
    const userLeadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id title slug');
    const leadMagnetIds = userLeadMagnets.map(lm => lm._id);

    // Create a map for quick lookup
    const magnetMap = new Map(userLeadMagnets.map(lm => [lm._id.toString(), lm.title || lm.slug]));

    // Get all leads
    const leads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 });

    // Generate CSV
    const csvHeader = 'email,lead_magnet,captured_at,delivery_status\n';
    const csvRows = leads.map(lead => 
      `${lead.email},"${magnetMap.get(lead.leadMagnetId.toString()) || 'Unknown'}",${lead.createdAt.toISOString()},${lead.deliveryStatus}`
    ).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="all-leads.csv"');
    res.send(csv);
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

    // Get brand settings if available
    let brandSettings: IBrandSettings | undefined;
    let brandName: string | undefined;
    
    if (leadMagnet.brandId) {
      const brand = await Brand.findById(leadMagnet.brandId);
      if (brand) {
        brandSettings = brand.settings;
        brandName = brand.name;
      }
    }

    // Regenerate PDF with brand
    const pdfBuffer = await generatePdf(leadMagnet.contentJson, leadMagnet.type, brandSettings, brandName);

    // Upload new PDF (works with both local and cloud storage)
    const filename = `pdfs/${req.user._id}/${leadMagnet.slug}-${uuidv4().slice(0, 8)}.pdf`;
    const pdfUrl = await uploadPdf(pdfBuffer, filename);
    
    leadMagnet.pdfUrl = pdfUrl;
    await leadMagnet.save();

    logger.info('PDF regenerated successfully', {
      userId: req.user._id,
      leadMagnetId: leadMagnet._id,
      pdfUrl,
    });

    res.json({
      success: true,
      data: { pdfUrl },
    });
  } catch (error) {
    next(error);
  }
}

