import type { Request, Response, NextFunction } from 'express';
import { Quiz } from '../models/Quiz.js';
import { QuizResponse } from '../models/QuizResponse.js';
import { User } from '../models/User.js';
import { Brand } from '../models/Brand.js';
import { sendQuizResultEmail } from '../services/emailService.js';
import { calculateQuizResult, validateQuizResponses } from '../utils/quizCalculation.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { ApiResponse, IQuiz, IQuizResult, IQuizResponse } from '../types/index.js';

// ============================================
// Traffic Source Detection
// ============================================

interface SourceInfo {
  source: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
}

function detectSource(req: Request): SourceInfo {
  // Check UTM parameters first (explicit tracking)
  const utmSource = req.query.utm_source as string | undefined;
  const utmMedium = req.query.utm_medium as string | undefined;
  const utmCampaign = req.query.utm_campaign as string | undefined;

  const referrer = req.headers.referer || (req.headers.referrer as string | undefined);

  if (utmSource) {
    return {
      source: utmSource.toLowerCase(),
      medium: utmMedium?.toLowerCase(),
      campaign: utmCampaign,
      referrer,
    };
  }

  // No referrer = direct traffic
  if (!referrer) {
    return { source: 'direct', referrer: undefined };
  }

  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();

    // Match known sources
    if (host.includes('google')) return { source: 'google', medium: 'organic', referrer };
    if (host.includes('bing')) return { source: 'bing', medium: 'organic', referrer };
    if (host.includes('duckduckgo')) return { source: 'duckduckgo', medium: 'organic', referrer };
    if (host.includes('twitter') || host.includes('x.com') || host.includes('t.co')) {
      return { source: 'twitter', medium: 'social', referrer };
    }
    if (host.includes('facebook') || host.includes('fb.com')) {
      return { source: 'facebook', medium: 'social', referrer };
    }
    if (host.includes('linkedin')) return { source: 'linkedin', medium: 'social', referrer };
    if (host.includes('instagram')) return { source: 'instagram', medium: 'social', referrer };
    if (host.includes('youtube')) return { source: 'youtube', medium: 'social', referrer };
    if (host.includes('reddit')) return { source: 'reddit', medium: 'social', referrer };
    if (host.includes('tiktok')) return { source: 'tiktok', medium: 'social', referrer };
    if (host.includes('pinterest')) return { source: 'pinterest', medium: 'social', referrer };

    // Return the domain as source for unknown referrers
    return { source: host.replace('www.', ''), medium: 'referral', referrer };
  } catch {
    return { source: 'direct', referrer };
  }
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0];
    return firstIp ? firstIp.trim() : undefined;
  }
  return req.socket?.remoteAddress;
}

// ============================================
// Get Published Quiz
// ============================================

export async function getQuiz(
  req: Request,
  res: Response<ApiResponse<{ quiz: Partial<IQuiz> }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

    if (!username || !slug) {
      throw AppError.notFound('Quiz not found');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Quiz not found');
    }

    // Find published quiz
    const quiz = await Quiz.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      status: 'published',
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Get brand information for branding display
    let brandInfo: { sourceType: string; sourceUrl: string; name: string } | null = null;
    if (quiz.brandId) {
      const brand = await Brand.findById(quiz.brandId).select('sourceType sourceUrl name');
      if (brand) {
        brandInfo = {
          sourceType: brand.sourceType,
          sourceUrl: brand.sourceUrl,
          name: brand.name,
        };
      }
    }

    // Track view (async, don't block response)
    Quiz.updateOne({ _id: quiz._id }, { $inc: { 'stats.views': 1 } }).catch((err) => {
      logger.error('Failed to track quiz view', err);
    });

    // Return quiz data for frontend rendering
    // Exclude internal fields like stats
    const quizData: Partial<IQuiz> & { brandInfo?: { sourceType: string; sourceUrl: string; name: string } | null } = {
      _id: quiz._id,
      title: quiz.title,
      subtitle: quiz.subtitle,
      coverImageUrl: quiz.coverImageUrl,
      slug: quiz.slug,
      emailCapturePoint: quiz.emailCapturePoint,
      emailFields: quiz.emailFields,
      privacyText: quiz.privacyText,
      questions: quiz.questions,
      results: quiz.results.map((r) => ({
        // Include result data but not the mapping (client doesn't need it)
        _id: r._id,
        name: r.name,
        emoji: r.emoji,
        summary: r.summary,
        traits: r.traits,
        recommendation: r.recommendation,
        ctaText: r.ctaText,
        ctaUrl: r.ctaUrl,
        imageUrl: r.imageUrl,
      })) as IQuizResult[],
      theme: quiz.theme,
      primaryColor: quiz.primaryColor,
      accentColor: quiz.accentColor,
      logoUrl: quiz.logoUrl,
      fontStyle: quiz.fontStyle,
      brandInfo: brandInfo,
    };

    res.json({
      success: true,
      data: { quiz: quizData },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Start Quiz (Record Start Event)
// ============================================

export async function startQuiz(
  req: Request,
  res: Response<ApiResponse<{ sessionId: string }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

    if (!username || !slug) {
      throw AppError.notFound('Quiz not found');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Quiz not found');
    }

    // Find published quiz
    const quiz = await Quiz.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      status: 'published',
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Increment start count
    await Quiz.updateOne({ _id: quiz._id }, { $inc: { 'stats.starts': 1 } });

    // Detect source and create a session
    const sourceInfo = detectSource(req);

    // Create a preliminary response record (can be updated on submit)
    const response = await QuizResponse.create({
      quizId: quiz._id,
      startedAt: new Date(),
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
      referrer: sourceInfo.referrer,
      source: sourceInfo.source,
      medium: sourceInfo.medium,
      campaign: sourceInfo.campaign,
      emailDeliveryStatus: 'pending',
    });

    logger.info('Quiz started', {
      quizId: quiz._id,
      responseId: response._id,
      source: sourceInfo.source,
    });

    res.json({
      success: true,
      data: { sessionId: response._id.toString() },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Submit Quiz (Answers + Email)
// ============================================

export async function submitQuiz(
  req: Request,
  res: Response<ApiResponse<{ result: IQuizResult }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;
    const { sessionId, answers, email, firstName, phone } = req.body;

    if (!username || !slug) {
      throw AppError.notFound('Quiz not found');
    }

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      throw AppError.badRequest('Answers are required');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Quiz not found');
    }

    // Find published quiz
    const quiz = await Quiz.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      status: 'published',
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Validate required fields based on quiz settings
    if (quiz.emailFields.requireEmail && !email) {
      throw AppError.badRequest('Email is required');
    }

    if (quiz.emailFields.requireName && !firstName) {
      throw AppError.badRequest('Name is required');
    }

    if (quiz.emailFields.requirePhone && !phone) {
      throw AppError.badRequest('Phone is required');
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw AppError.badRequest('Please provide a valid email address');
      }
    }

    // Validate responses
    const formattedAnswers = answers.map((a: { questionId: string; answerId: string }) => ({
      questionId: a.questionId,
      answerId: a.answerId,
    }));

    const validation = validateQuizResponses(formattedAnswers, quiz);
    if (!validation.isValid) {
      throw AppError.badRequest(`Please answer all questions. Missing: ${validation.missingQuestions.length} questions`);
    }

    // Calculate result
    const result = calculateQuizResult(formattedAnswers, quiz);

    if (!result) {
      throw AppError.internal('Could not calculate quiz result');
    }

    // Check for existing response by email (to prevent duplicates)
    let response: IQuizResponse | null = null;

    if (sessionId) {
      // Try to find existing session
      response = await QuizResponse.findById(sessionId);
    }

    if (email) {
      // Check if email already exists for this quiz (any status)
      const existing = await QuizResponse.findOne({
        quizId: quiz._id,
        email: email.toLowerCase(),
      });

      if (existing) {
        // If completed, return existing result (idempotent)
        if (existing.completedAt) {
          const existingResult = quiz.results.find(
            (r) => r._id.toString() === existing.resultId?.toString()
          );

          logger.info('Returning existing quiz result', {
            quizId: quiz._id,
            email: email.toLowerCase(),
            resultId: existing.resultId,
          });

          res.json({
            success: true,
            data: { result: existingResult || result },
          });
          return;
        }

        // If incomplete, reuse the existing response instead of sessionId
        logger.info('Reusing existing incomplete response', {
          quizId: quiz._id,
          email: email.toLowerCase(),
          existingResponseId: existing._id,
        });
        response = existing;
      }
    }

    // Update or create response
    const now = new Date();
    const responseData = {
      quizId: quiz._id,
      email: email?.toLowerCase(),
      firstName,
      phone,
      answers: formattedAnswers.map((a) => ({
        ...a,
        timestamp: now,
      })),
      resultId: result._id,
      completedAt: now,
      emailCapturedAt: email ? now : undefined,
      emailDeliveryStatus: email ? 'pending' : 'skipped',
    };

    // Track if this is a new email capture
    const isNewEmailCapture = email && (!response || !response.email);

    if (response) {
      // Update existing session
      Object.assign(response, responseData);
      await response.save();
    } else {
      // Create new response
      const sourceInfo = detectSource(req);
      response = await QuizResponse.create({
        ...responseData,
        startedAt: now,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
        referrer: sourceInfo.referrer,
        source: sourceInfo.source,
        medium: sourceInfo.medium,
        campaign: sourceInfo.campaign,
      });
    }

    // Update quiz stats - only increment emailsCaptured if it's a NEW email
    const statsUpdate: Record<string, number> = {
      'stats.completions': 1,
    };
    if (isNewEmailCapture) {
      statsUpdate['stats.emailsCaptured'] = 1;
    }
    await Quiz.updateOne({ _id: quiz._id }, { $inc: statsUpdate });

    logger.info('Quiz submitted', {
      quizId: quiz._id,
      responseId: response._id,
      resultId: result._id,
      resultName: result.name,
      hasEmail: !!email,
    });

    // Send result email asynchronously
    if (email) {
      setImmediate(() => {
        sendQuizResultEmail({
          to: email.toLowerCase(),
          firstName: firstName || undefined,
          quiz,
          result,
        })
          .then((success) => {
            if (success) {
              QuizResponse.updateOne(
                { _id: response!._id },
                { emailDeliveryStatus: 'sent' }
              ).catch((err) => logger.error('Failed to update email status', err));
            } else {
              QuizResponse.updateOne(
                { _id: response!._id },
                { emailDeliveryStatus: 'failed' }
              ).catch((err) => logger.error('Failed to update email status', err));
            }
          })
          .catch((err) => {
            logger.error('Failed to send quiz result email', err);
            QuizResponse.updateOne(
              { _id: response!._id },
              { emailDeliveryStatus: 'failed' }
            ).catch((updateErr) => logger.error('Failed to update email status', updateErr));
          });
      });
    }

    res.json({
      success: true,
      data: { result },
    });
  } catch (error) {
    next(error);
  }
}

