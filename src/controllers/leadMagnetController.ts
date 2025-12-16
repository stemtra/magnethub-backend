import type { Response, NextFunction } from 'express';
import slugify from 'slugify';
import { v4 as uuidv4 } from 'uuid';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { Brand } from '../models/Brand.js';
import { runPipelineToContent, generateLandingPageCopy, generateEmailSequence } from '../services/aiService.js';
import { generatePdf } from '../services/pdfService.js';
import { uploadPdf, getSignedPdfUrl } from '../services/storageService.js';
import { renderLandingPage } from '../services/templateService.js';
import { getRemainingGenerations } from '../middleware/rateLimit.js';
import { billingService } from '../services/billingService.js';
import { isInstagramUrl, extractUsername, normalizeInstagramUrl } from '../services/instagramService.js';
import { isYouTubeUrl, extractYouTubeHandle, normalizeYouTubeUrl } from '../services/youtubeService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, ILeadMagnet, IBrandSettings, SourceType, IBrand } from '../types/index.js';

async function attachSignedPdfUrl<T extends { pdfUrl?: string }>(
  leadMagnet: T
): Promise<T> {
  if (!leadMagnet.pdfUrl) return leadMagnet;

  try {
    const signedUrl = await getSignedPdfUrl(leadMagnet.pdfUrl);
    return { ...leadMagnet, pdfUrl: signedUrl };
  } catch (error) {
    logger.error('Failed to attach signed PDF URL; returning original.', {
      error,
      pdfUrl: leadMagnet.pdfUrl,
    });
    return leadMagnet;
  }
}

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
    const phase1 = await runPipelineToContent(sourceUrl, {
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
      const brandSettings: IBrandSettings = { ...phase1.extractedBrand };
      
      // For Instagram, use profile picture as logo
      if (sourceType === 'instagram' && phase1.instagramProfilePic) {
        brandSettings.logoUrl = phase1.instagramProfilePic;
      }
      
      // For YouTube, use channel thumbnail as logo
      if (sourceType === 'youtube' && phase1.youtubeThumbnail) {
        brandSettings.logoUrl = phase1.youtubeThumbnail;
      }
      
      // Check if this is the first brand
      const brandCount = await Brand.countDocuments({ userId: req.user._id });
      
      brand = await Brand.create({
        userId: req.user._id,
        name: brandName,
        description: phase1.sourceDescription,
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
        hasDescription: !!phase1.sourceDescription,
      });
    } else if (!brand.description && phase1.sourceDescription) {
      // Update existing brand with description if missing
      brand.description = phase1.sourceDescription;
      await brand.save();
      logger.info('Updated brand with description', { brandId: brand._id });
    }

    // We'll generate landing page + emails asynchronously after responding.
    const formAction = `/public/${req.user.username}/${slug}/subscribe`;
    const finalBrandSettings = brandToUse || brand!.settings;

    // Generate PDF with brand settings
    const pdfBuffer = await generatePdf(phase1.content, type, finalBrandSettings, brand!.name);

    // Upload PDF to storage (local or cloud)
    const filename = `pdfs/${req.user._id}/${slug}-${uuidv4().slice(0, 8)}.pdf`;
    const pdfUrl = await uploadPdf(pdfBuffer, filename);

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
      title: phase1.content.title,
      pdfUrl,
      // landingPageHtml/landingPageCopyJson/emailsJson will be filled async
      outlineJson: phase1.outline,
      metaJson: phase1.meta,
      contentJson: phase1.content,
      slug,
      isPublished: true,
      generationStatus: 'pdf_ready',
      landingStatus: 'pending',
      emailsStatus: 'pending',
    });

    const leadMagnetWithSignedUrl = await attachSignedPdfUrl(leadMagnet.toObject());

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
      data: { leadMagnet: leadMagnetWithSignedUrl },
    });

    // ============================================
    // Async completion (landing page + emails)
    // ============================================
    // NOTE: In-process async. If the server restarts, these may remain pending.
    // Workspace UI will show "Generating..." and we can later add a queue/worker.
    setImmediate(() => {
      void (async () => {
        const leadMagnetId = leadMagnet._id;
        try {
          const landingCopyPromise = generateLandingPageCopy(phase1.meta, phase1.content, sourceType);
          const emailsPromise = generateEmailSequence(phase1.meta, phase1.content, pdfUrl, tone, goal, sourceType);

          const [landingCopyRes, emailsRes] = await Promise.allSettled([landingCopyPromise, emailsPromise]);

          let landingPageCopy: any | undefined;
          let emailsJson: any | undefined;
          let landingStatus: 'ready' | 'failed' = 'failed';
          let emailsStatus: 'ready' | 'failed' = 'failed';

          if (landingCopyRes.status === 'fulfilled') {
            landingPageCopy = landingCopyRes.value;
            landingStatus = 'ready';
          }

          if (emailsRes.status === 'fulfilled') {
            emailsJson = emailsRes.value;
            emailsStatus = 'ready';
          }

          let landingPageHtml: string | undefined;
          if (landingPageCopy) {
            landingPageHtml = await renderLandingPage(finalBrandSettings, landingPageCopy, formAction);
          }

          const generationStatus =
            landingStatus === 'ready' && emailsStatus === 'ready' ? 'complete' : 'needs_attention';

          const generationError =
            generationStatus === 'needs_attention'
              ? [
                  landingStatus === 'failed' ? 'landing_failed' : null,
                  emailsStatus === 'failed' ? 'emails_failed' : null,
                ].filter(Boolean).join(',')
              : undefined;

          await LeadMagnet.updateOne(
            { _id: leadMagnetId },
            {
              landingPageHtml,
              landingPageCopyJson: landingPageCopy,
              emailsJson,
              landingStatus,
              emailsStatus,
              generationStatus,
              generationError,
            }
          );

          logger.info('Lead magnet async completion finished', {
            leadMagnetId: leadMagnetId.toString(),
            landingStatus,
            emailsStatus,
            generationStatus,
          });
        } catch (error) {
          logger.error('Lead magnet async completion failed', { leadMagnetId: leadMagnetId.toString(), error });
          await LeadMagnet.updateOne(
            { _id: leadMagnetId },
            {
              generationStatus: 'needs_attention',
              landingStatus: 'failed',
              emailsStatus: 'failed',
              generationError: error instanceof Error ? error.message : 'async_completion_failed',
            }
          );
        }
      })();
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

    const leadMagnetsWithSignedUrls = await Promise.all(
      leadMagnets.map(async (lm) => attachSignedPdfUrl(lm.toObject()))
    );

    const remaining = await getRemainingGenerations(req.user._id.toString());

    res.json({
      success: true,
      data: { leadMagnets: leadMagnetsWithSignedUrls, remaining },
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

    const leadMagnetWithSignedUrl = await attachSignedPdfUrl(leadMagnet.toObject());

    res.json({
      success: true,
      data: { leadMagnet: leadMagnetWithSignedUrl },
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

    // Get all quizzes for this user
    const { Quiz } = await import('../models/Quiz.js');
    const { QuizResponse } = await import('../models/QuizResponse.js');
    const userQuizzes = await Quiz.find({ userId: req.user._id }).select('_id title slug');
    const quizIds = userQuizzes.map(q => q._id);

    // Get all leads for lead magnets
    const leads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 });

    // Get all quiz responses with emails (quiz leads)
    const quizResponses = await QuizResponse.find({ 
      quizId: { $in: quizIds },
      email: { $exists: true, $ne: '' }
    }).sort({ createdAt: -1 });

    // Create maps for quick lookup
    const magnetMap = new Map(userLeadMagnets.map(lm => [lm._id.toString(), {
      id: lm._id.toString(),
      title: lm.title || 'Untitled',
      slug: lm.slug,
      type: lm.type,
    }]));

    const quizMap = new Map(userQuizzes.map(q => [q._id.toString(), {
      id: q._id.toString(),
      title: q.title || 'Untitled Quiz',
      slug: q.slug,
      type: 'quiz',
    }]));

    // Enrich lead magnet leads
    const enrichedLeads: LeadWithMagnet[] = leads.map(lead => ({
      id: lead._id.toString(),
      email: lead.email,
      leadMagnetId: lead.leadMagnetId.toString(),
      deliveryStatus: lead.deliveryStatus,
      createdAt: lead.createdAt,
      leadMagnet: magnetMap.get(lead.leadMagnetId.toString()),
    }));

    // Enrich quiz leads
    const enrichedQuizLeads: LeadWithMagnet[] = quizResponses.map(response => ({
      id: response._id.toString(),
      email: response.email!,
      leadMagnetId: response.quizId.toString(),
      deliveryStatus: response.emailDeliveryStatus,
      createdAt: response.createdAt,
      leadMagnet: quizMap.get(response.quizId.toString()),
    }));

    // Combine and sort by creation date
    const allLeads = [...enrichedLeads, ...enrichedQuizLeads].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: { leads: allLeads, total: allLeads.length },
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

    // Get all quizzes for this user
    const { Quiz } = await import('../models/Quiz.js');
    const { QuizResponse } = await import('../models/QuizResponse.js');
    const userQuizzes = await Quiz.find({ userId: req.user._id }).select('_id title slug');
    const quizIds = userQuizzes.map(q => q._id);

    // Create maps for quick lookup
    const magnetMap = new Map(userLeadMagnets.map(lm => [lm._id.toString(), lm.title || lm.slug]));
    const quizMap = new Map(userQuizzes.map(q => [q._id.toString(), q.title || q.slug]));

    // Get all leads from lead magnets
    const leads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 });

    // Get all quiz responses with emails
    const quizResponses = await QuizResponse.find({ 
      quizId: { $in: quizIds },
      email: { $exists: true, $ne: '' }
    }).sort({ createdAt: -1 });

    // Generate CSV
    const csvHeader = 'email,lead_magnet,type,captured_at,delivery_status\n';
    
    const leadRows = leads.map(lead => 
      `${lead.email},"${magnetMap.get(lead.leadMagnetId.toString()) || 'Unknown'}",PDF,${lead.createdAt.toISOString()},${lead.deliveryStatus}`
    );

    const quizRows = quizResponses.map(response => 
      `${response.email},"${quizMap.get(response.quizId.toString()) || 'Unknown'}",Quiz,${response.createdAt.toISOString()},${response.emailDeliveryStatus}`
    );

    const allRows = [...leadRows, ...quizRows].sort((a, b) => {
      // Extract timestamps and sort descending
      const timeA = a.split(',')[3];
      const timeB = b.split(',')[3];
      return timeB.localeCompare(timeA);
    });

    const csv = csvHeader + allRows.join('\n');

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

