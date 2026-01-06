import type { Response, NextFunction } from 'express';
import slugify from 'slugify';
import { v4 as uuidv4 } from 'uuid';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Quiz } from '../models/Quiz.js';
import { Lead } from '../models/Lead.js';
import { Brand } from '../models/Brand.js';
import { User } from '../models/User.js';
import { runPipelineToContent, generateLandingPageCopy, generateEmailSequence } from '../services/aiService.js';
import { generateQuiz } from '../services/quizGenerationService.js';
import { generateInfographic } from '../services/infographicService.js';
import { generatePdf } from '../services/pdfService.js';
import { uploadPdf, getSignedPdfUrl, getSignedImageUrl, uploadFile, getSignedFileUrl, deleteFile } from '../services/storageService.js';
import { renderLandingPage } from '../services/templateService.js';
import { getRemainingGenerations } from '../middleware/rateLimit.js';
import { billingService } from '../services/billingService.js';
import { isInstagramUrl, extractUsername, normalizeInstagramUrl } from '../services/instagramService.js';
import { isYouTubeUrl, extractYouTubeHandle, normalizeYouTubeUrl } from '../services/youtubeService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, ILeadMagnet, IQuiz, IBrandSettings, SourceType, IBrand, UploadedFileType, LeadMagnetType } from '../types/index.js';

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a clean, short slug from a title
 * Takes first 60 characters or first 7 words (whichever is shorter)
 */
function generateSlugFromTitle(title: string): string {
  // Take first 7 words or first 60 chars, whichever is shorter
  const words = title.split(/\s+/);
  const truncated = words.length > 7 
    ? words.slice(0, 7).join(' ')
    : title;
  
  const limited = truncated.length > 60 ? truncated.substring(0, 60) : truncated;
  
  return slugify(limited, { lower: true, strict: true });
}

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

async function attachSignedImageUrl<T extends { infographicUrl?: string }>(
  leadMagnet: T
): Promise<T> {
  if (!leadMagnet.infographicUrl) return leadMagnet;

  try {
    const signedUrl = await getSignedImageUrl(leadMagnet.infographicUrl);
    return { ...leadMagnet, infographicUrl: signedUrl };
  } catch (error) {
    logger.error('Failed to attach signed image URL; returning original.', {
      error,
      infographicUrl: leadMagnet.infographicUrl,
    });
    return leadMagnet;
  }
}

async function attachSignedUploadedFileUrl<T extends { uploadedFileUrl?: string; uploadedFileMimeType?: string }>(
  leadMagnet: T
): Promise<T> {
  if (!leadMagnet.uploadedFileUrl || !leadMagnet.uploadedFileMimeType) return leadMagnet;

  try {
    const signedUrl = await getSignedFileUrl(leadMagnet.uploadedFileUrl, leadMagnet.uploadedFileMimeType);
    return { ...leadMagnet, uploadedFileUrl: signedUrl };
  } catch (error) {
    logger.error('Failed to attach signed uploaded file URL; returning original.', {
      error,
      uploadedFileUrl: leadMagnet.uploadedFileUrl,
    });
    return leadMagnet;
  }
}

async function attachSignedUrls<T extends { pdfUrl?: string; infographicUrl?: string; uploadedFileUrl?: string; uploadedFileMimeType?: string }>(
  leadMagnet: T
): Promise<T> {
  let result = leadMagnet;
  result = await attachSignedPdfUrl(result);
  result = await attachSignedImageUrl(result);
  result = await attachSignedUploadedFileUrl(result);
  return result;
}

// ============================================
// Generate Lead Magnet (New Unified Flow)
// ============================================

export async function generateUnified(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnet?: ILeadMagnet; quiz?: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { brandId, topic, type, numQuestions, numResults, infographicStyle, infographicOrientation } = req.body;

    // Validate required fields
    if (!brandId) {
      throw AppError.badRequest('Brand ID is required');
    }
    if (!topic) {
      throw AppError.badRequest('Topic is required');
    }
    if (!type) {
      throw AppError.badRequest('Lead magnet type is required');
    }

    // Get brand
    const brand = await Brand.findOne({ _id: brandId, userId: req.user._id });
    if (!brand) {
      throw AppError.badRequest('Brand not found');
    }

    // Get user's subscription to determine privacy setting
    const subscription = await billingService.getOrCreateSubscription(req.user._id.toString());
    const userDoc = await User.findById(req.user._id);

    // Determine if lead magnet should be public
    // Free plans: always public
    // Paid plans: use user's default privacy setting (default to public)
    const isPublic = subscription.plan === 'free'
      ? true
      : (userDoc?.defaultLeadMagnetPrivacy !== 'private');

    logger.info('Starting unified lead magnet generation', {
      userId: req.user._id,
      brandId: brand._id,
      type,
      topic,
      isPublic,
      plan: subscription.plan,
    });

    // Branch based on type
    if (type === 'quiz') {
      // ============================================
      // QUIZ GENERATION PATH
      // ============================================

      const quizNumQuestions = numQuestions || 10;
      const quizNumResults = numResults || 4;

      // Generate quiz content
      const generatedQuiz = await generateQuiz({
        topic,
        brand,
        numQuestions: quizNumQuestions,
        numResults: quizNumResults,
      });

      // Generate unique slug from title (not the full topic)
      const baseSlug = generateSlugFromTitle(generatedQuiz.title);
      let slug = baseSlug;
      let counter = 1;
      while (await Quiz.findOne({ userId: req.user._id, slug })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // Map generated quiz to Quiz model structure
      const quiz = await Quiz.create({
        userId: req.user._id,
        brandId: brand._id,
        title: generatedQuiz.title,
        subtitle: generatedQuiz.subtitle,
        slug,
        questions: generatedQuiz.questions.map((q, idx) => ({
          questionText: q.questionText,
          order: idx,
          answers: q.answers.map(a => ({
            answerText: a.answerText,
            // resultMapping will be set after results are created (see lines 134-139)
          })),
        })),
        results: generatedQuiz.results.map(r => ({
          name: r.name,
          emoji: r.emoji,
          summary: r.summary,
          traits: r.traits,
          recommendation: r.recommendation,
        })),
        primaryColor: brand.settings.primaryColor,
        accentColor: brand.settings.accentColor,
        logoUrl: brand.settings.logoUrl,
        theme: brand.settings.theme === 'dark' ? 'dark' : 'light',
        status: 'published',
        isPublic,
      });

      // Map result IDs back to answers
      quiz.questions.forEach((question, qIdx) => {
        question.answers.forEach((answer, aIdx) => {
          const originalAnswer = generatedQuiz.questions[qIdx].answers[aIdx];
          answer.resultMapping = quiz.results[originalAnswer.resultIndex]._id;
        });
      });
      await quiz.save();

      // Record usage for billing
      await billingService.recordLeadMagnetUsage(req.user._id.toString());

      logger.info('Quiz generated successfully', {
        userId: req.user._id,
        quizId: quiz._id,
        slug: quiz.slug,
      });

      res.status(201).json({
        success: true,
        data: { quiz },
      });
    } else if (type === 'infographic') {
      // ============================================
      // INFOGRAPHIC GENERATION PATH
      // ============================================

      const style = infographicStyle || 'modern';
      const orientation = infographicOrientation || 'square';

      // Generate infographic using Gemini
      const generatedInfographic = await generateInfographic({
        topic,
        brand,
        style,
        orientation,
      });

      // Generate unique slug from title (not the full topic)
      const baseSlug = generateSlugFromTitle(generatedInfographic.title);
      let slug = baseSlug;
      let counter = 1;
      while (await LeadMagnet.findOne({ userId: req.user._id, slug })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // Create lead magnet record for infographic
      const leadMagnet = await LeadMagnet.create({
        userId: req.user._id,
        brandId: brand._id,
        sourceType: brand.sourceType,
        sourceUrl: brand.sourceUrl,
        goal: 'get_leads', // Default goal for infographics
        type: 'infographic',
        tone: 'professional', // Default tone
        title: generatedInfographic.title,
        infographicUrl: generatedInfographic.imageUrl,
        infographicStyle: style,
        infographicOrientation: orientation,
        slug,
        isPublished: true,
        isPublic,
        generationStatus: 'complete',
        landingStatus: 'pending', // Landing page generated async
        emailsStatus: 'ready', // Not generating emails for MVP
      });

      // Record usage for billing
      await billingService.recordLeadMagnetUsage(req.user._id.toString());

      logger.info('Infographic generated successfully', {
        userId: req.user._id,
        leadMagnetId: leadMagnet._id,
        slug: leadMagnet.slug,
      });

      res.status(201).json({
        success: true,
        data: { leadMagnet },
      });

      // ============================================
      // Async landing page generation for infographic
      // ============================================
      const formAction = `/public/${req.user.username}/${slug}/subscribe`;
      const finalBrandSettings = brand.settings;

      setImmediate(() => {
        void (async () => {
          const leadMagnetId = leadMagnet._id;
          try {
            // Create landing page copy for infographic
            const landingPageCopy = {
              headline: generatedInfographic.title,
              subheadline: `Get this beautiful infographic delivered to your inbox`,
              benefit_bullets: [
                'High-quality infographic design',
                'Perfect for sharing on social media',
                'Download and use for presentations',
              ],
              cta: 'Get Free Infographic',
              short_description: `Download your ${generatedInfographic.title} infographic`,
              html: '',
            };

            // Render landing page HTML with brand settings
            const landingPageHtml = await renderLandingPage(finalBrandSettings, landingPageCopy, formAction);

            // Create delivery email for infographic
            const deliveryEmail = {
              title: 'Delivery Email',
              subject: `Your Infographic: ${generatedInfographic.title}`,
              body_text: `Hi there!\n\nThanks for your interest in "${generatedInfographic.title}"!\n\nYou can download your infographic here:\n{{INFOGRAPHIC_URL}}\n\nFeel free to share it on social media or use it in your presentations!\n\nEnjoy!\n\n, Powered by MagnetHub`,
              body_html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">
    <tr>
      <td style="padding: 40px 20px;">
        ${finalBrandSettings.logoUrl ? `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="text-align: center; padding-bottom: 30px;">
              <img src="${finalBrandSettings.logoUrl}" alt="" style="max-height: 50px; max-width: 150px;">
            </td>
          </tr>
        </table>
        ` : ''}
        
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">Hi there!</p>
              
              <p style="margin: 0 0 30px; font-size: 16px; color: #374151;">
                Thanks for your interest in "<strong>${generatedInfographic.title}</strong>"!
              </p>

              <div style="text-align: center; margin: 30px 0;">
                <a href="{{INFOGRAPHIC_URL}}" target="_blank" rel="noopener noreferrer">
                  <img src="{{INFOGRAPHIC_URL}}" alt="${generatedInfographic.title}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </a>
              </div>

              <div style="text-align: center; padding: 30px 0;">
                <a href="{{INFOGRAPHIC_URL}}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 16px 32px; background-color: ${finalBrandSettings.primaryColor || '#10B981'}; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                  Download Infographic
                </a>
              </div>

              <p style="margin: 30px 0 0; font-size: 14px; color: #6b7280; text-align: center;">
                Feel free to share it on social media or use it in your presentations!
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="text-align: center; padding-top: 30px;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                Powered by <a href="https://magnethubai.com" target="_blank" rel="noopener noreferrer" style="color: #6b7280;">MagnetHub</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
              `.trim(),
            };

            await LeadMagnet.updateOne(
              { _id: leadMagnetId },
              {
                landingPageHtml,
                landingPageCopyJson: landingPageCopy,
                emailsJson: { emails: [deliveryEmail] },
                landingStatus: 'ready',
                emailsStatus: 'ready',
              }
            );

            logger.info('Infographic landing page and email generated', {
              leadMagnetId: leadMagnetId.toString(),
              landingStatus: 'ready',
              emailsStatus: 'ready',
            });
          } catch (error) {
            logger.error('Infographic landing page generation failed', { 
              leadMagnetId: leadMagnetId.toString(), 
              error 
            });
            await LeadMagnet.updateOne(
              { _id: leadMagnetId },
              {
                landingStatus: 'failed',
                emailsStatus: 'failed',
                generationError: error instanceof Error ? error.message : 'landing_generation_failed',
              }
            );
          }
        })();
      });
    } else {
      // ============================================
      // OTHER LEAD MAGNET TYPES (Coming Soon)
      // ============================================

      throw AppError.badRequest(`Lead magnet type "${type}" is not yet supported. Only "quiz" and "infographic" are available.`);
    }
  } catch (error) {
    next(error);
  }
}

// ============================================
// Generate Lead Magnet (Legacy Flow)
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

    // Get user's subscription to determine privacy setting
    const subscription = await billingService.getOrCreateSubscription(req.user._id.toString());
    const userDoc = await User.findById(req.user._id);

    // Determine if lead magnet should be public
    const isPublic = subscription.plan === 'free'
      ? true
      : (userDoc?.defaultLeadMagnetPrivacy !== 'private');

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
      isPublic,
      generationStatus: 'pdf_ready',
      landingStatus: 'pending',
      emailsStatus: 'pending',
    });

    const leadMagnetWithSignedUrl = await attachSignedUrls(leadMagnet.toObject());

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
      leadMagnets.map(async (lm) => attachSignedUrls(lm.toObject()))
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

    const leadMagnetWithSignedUrl = await attachSignedUrls(leadMagnet.toObject());

    res.json({
      success: true,
      data: { leadMagnet: leadMagnetWithSignedUrl },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Update Lead Magnet
// ============================================

export async function update(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnet: ILeadMagnet }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;
    const { title } = req.body;

    const leadMagnet = await LeadMagnet.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Lead magnet not found');
    }

    // Update fields
    if (title !== undefined) {
      leadMagnet.title = title;
    }

    await leadMagnet.save();

    const leadMagnetWithSignedUrl = await attachSignedUrls(leadMagnet.toObject());

    logger.info('Lead magnet updated', {
      userId: req.user._id,
      leadMagnetId: id,
      updates: { title },
    });

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

    // Delete associated files from R2
    const { deletePdf, deleteImage, deleteFile: deleteR2File } = await import('../services/storageService.js');

    // Delete PDF if it exists
    if (leadMagnet.pdfUrl) {
      try {
        await deletePdf(leadMagnet.pdfUrl);
        logger.info('PDF deleted from R2', { pdfUrl: leadMagnet.pdfUrl });
      } catch (error) {
        logger.warn('Failed to delete PDF from R2 (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
          pdfUrl: leadMagnet.pdfUrl,
        });
      }
    }

    // Delete infographic if it exists
    if (leadMagnet.infographicUrl) {
      try {
        await deleteImage(leadMagnet.infographicUrl);
        logger.info('Infographic deleted from R2', { infographicUrl: leadMagnet.infographicUrl });
      } catch (error) {
        logger.warn('Failed to delete infographic from R2 (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
          infographicUrl: leadMagnet.infographicUrl,
        });
      }
    }

    // Delete uploaded file if it exists
    if (leadMagnet.uploadedFileUrl) {
      try {
        await deleteR2File(leadMagnet.uploadedFileUrl);
        logger.info('Uploaded file deleted from R2', { uploadedFileUrl: leadMagnet.uploadedFileUrl });
      } catch (error) {
        logger.warn('Failed to delete uploaded file from R2 (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
          uploadedFileUrl: leadMagnet.uploadedFileUrl,
        });
      }
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
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'skipped';
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

// ============================================
// Upload Media (User-uploaded files)
// ============================================

// Allowed MIME types and their corresponding file types
const ALLOWED_MIME_TYPES: Record<string, { fileType: UploadedFileType; folder: 'uploads/pdf' | 'uploads/image' | 'uploads/audio'; leadMagnetType: LeadMagnetType }> = {
  'application/pdf': { fileType: 'pdf', folder: 'uploads/pdf', leadMagnetType: 'uploaded_pdf' },
  'image/png': { fileType: 'image', folder: 'uploads/image', leadMagnetType: 'uploaded_image' },
  'image/jpeg': { fileType: 'image', folder: 'uploads/image', leadMagnetType: 'uploaded_image' },
  'image/webp': { fileType: 'image', folder: 'uploads/image', leadMagnetType: 'uploaded_image' },
  'audio/mpeg': { fileType: 'audio', folder: 'uploads/audio', leadMagnetType: 'uploaded_audio' },
  'audio/mp3': { fileType: 'audio', folder: 'uploads/audio', leadMagnetType: 'uploaded_audio' },
};

// Max file sizes in bytes
const MAX_FILE_SIZES: Record<UploadedFileType, number> = {
  pdf: 20 * 1024 * 1024, // 20MB
  image: 10 * 1024 * 1024, // 10MB
  audio: 20 * 1024 * 1024, // 20MB
};

export async function uploadMedia(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ leadMagnet: ILeadMagnet }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // multer adds file to req.file
    const file = req.file;
    if (!file) {
      throw AppError.badRequest('No file uploaded');
    }

    const { title, description, brandId } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw AppError.badRequest('Title is required');
    }

    if (!brandId) {
      throw AppError.badRequest('Brand ID is required');
    }

    // Validate brand exists and belongs to user
    const brand = await Brand.findOne({ _id: brandId, userId: req.user._id });
    if (!brand) {
      throw AppError.badRequest('Brand not found');
    }

    // Validate file type
    const mimeTypeConfig = ALLOWED_MIME_TYPES[file.mimetype];
    if (!mimeTypeConfig) {
      throw AppError.badRequest(
        `File type not supported. Allowed types: PDF, PNG, JPG, WebP, MP3`
      );
    }

    // Validate file size
    const maxSize = MAX_FILE_SIZES[mimeTypeConfig.fileType];
    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      throw AppError.badRequest(
        `File too large. Maximum size for ${mimeTypeConfig.fileType} files is ${maxSizeMB}MB`
      );
    }

    // Get user's subscription to determine privacy setting
    const subscription = await billingService.getOrCreateSubscription(req.user._id.toString());
    const userDoc = await User.findById(req.user._id);

    // Determine if lead magnet should be public
    const isPublic = subscription.plan === 'free'
      ? true
      : (userDoc?.defaultLeadMagnetPrivacy !== 'private');

    logger.info('Uploading user media file', {
      userId: req.user._id,
      brandId: brand._id,
      fileType: mimeTypeConfig.fileType,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    });

    // Upload to R2
    const uploadedUrl = await uploadFile({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      folder: mimeTypeConfig.folder,
      userId: req.user._id.toString(),
    });

    // Generate unique slug from title
    const baseSlug = slugify(title.trim(), { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await LeadMagnet.findOne({ userId: req.user._id, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Create lead magnet record
    const leadMagnet = await LeadMagnet.create({
      userId: req.user._id,
      brandId: brand._id,
      type: mimeTypeConfig.leadMagnetType,
      title: title.trim(),
      description: description?.trim() || undefined,
      slug,
      isPublished: true,
      isPublic,
      // User-uploaded media fields
      isUserUploaded: true,
      uploadedFileUrl: uploadedUrl,
      uploadedFileName: file.originalname,
      uploadedFileType: mimeTypeConfig.fileType,
      uploadedFileMimeType: file.mimetype,
      uploadedFileSize: file.size,
      // Set generation status - landing page will be generated async
      generationStatus: 'complete',
      landingStatus: 'pending',
      emailsStatus: 'ready', // Not generating emails for MVP
    });

    // Record usage for billing
    await billingService.recordLeadMagnetUsage(req.user._id.toString());

    const leadMagnetWithSignedUrl = await attachSignedUrls(leadMagnet.toObject());

    logger.info('User media uploaded successfully', {
      userId: req.user._id,
      leadMagnetId: leadMagnet._id,
      brandId: brand._id,
      slug,
      fileType: mimeTypeConfig.fileType,
    });

    res.status(201).json({
      success: true,
      data: { leadMagnet: leadMagnetWithSignedUrl },
    });

    // ============================================
    // Async generation (landing page copy for uploaded media)
    // ============================================
    const formAction = `/public/${req.user.username}/${slug}/subscribe`;
    const finalBrandSettings = brand.settings;
    const finalTitle = title.trim();
    const finalDescription = description?.trim() || `Download this ${mimeTypeConfig.fileType} resource`;
    const fileTypeLabel = mimeTypeConfig.fileType === 'pdf' ? 'PDF' :
      mimeTypeConfig.fileType === 'image' ? 'image' : 'audio';

    setImmediate(() => {
      void (async () => {
        const leadMagnetId = leadMagnet._id;
        try {
          // Create basic landing page copy for uploaded media
          const landingPageCopy = {
            headline: finalTitle,
            subheadline: finalDescription,
            benefit_bullets: [
              `Get instant access to this ${fileTypeLabel} resource`,
              'Download directly to your device',
              'Share with colleagues and friends',
            ],
            cta: 'Get Free Access',
            short_description: finalDescription,
            html: '', // Will be rendered by templateService
          };

          // Render landing page HTML with brand settings
          const landingPageHtml = await renderLandingPage(finalBrandSettings, landingPageCopy, formAction);

          await LeadMagnet.updateOne(
            { _id: leadMagnetId },
            {
              landingPageHtml,
              landingPageCopyJson: landingPageCopy,
              landingStatus: 'ready',
              emailsStatus: 'ready', // Mark as ready since we're not generating emails for MVP
            }
          );

          logger.info('Uploaded media landing page generated', {
            leadMagnetId: leadMagnetId.toString(),
            landingStatus: 'ready',
          });
        } catch (error) {
          logger.error('Uploaded media landing page generation failed', { leadMagnetId: leadMagnetId.toString(), error });
          await LeadMagnet.updateOne(
            { _id: leadMagnetId },
            {
              landingStatus: 'failed',
              emailsStatus: 'ready', // Not generating emails, so mark as ready
              generationError: error instanceof Error ? error.message : 'landing_generation_failed',
            }
          );
        }
      })();
    });
  } catch (error) {
    next(error);
  }
}

