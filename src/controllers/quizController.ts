import type { Response, NextFunction } from 'express';
import slugify from 'slugify';
import mongoose from 'mongoose';
import { Quiz } from '../models/Quiz.js';
import { QuizResponse } from '../models/QuizResponse.js';
import { Brand } from '../models/Brand.js';
import { LeadMagnet } from '../models/LeadMagnet.js';
import {
  generateQuizQuestions,
  generateQuizResults,
  generateAnswerMapping,
  convertGeneratedQuestionsToSchema,
  convertGeneratedResultsToSchema,
  applyAnswerMapping,
} from '../services/quizAIService.js';
import { getResultDistribution } from '../utils/quizCalculation.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, IQuiz, IQuizQuestion, IQuizResult } from '../types/index.js';

// ============================================
// Create Quiz
// ============================================

export async function create(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quiz: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const {
      title,
      subtitle,
      brandId,
      coverImageUrl,
      emailCapturePoint,
      emailFields,
      privacyText,
      questions,
      results,
      theme,
      primaryColor,
      accentColor,
      logoUrl,
      fontStyle,
    } = req.body;

    if (!title) {
      throw AppError.badRequest('Quiz title is required');
    }

    // Generate unique slug
    const baseSlug = slugify(title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (await Quiz.findOne({ userId: req.user._id, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Validate brandId if provided
    let brand = null;
    if (brandId) {
      brand = await Brand.findOne({ _id: brandId, userId: req.user._id });
      if (!brand) {
        throw AppError.badRequest('Selected brand not found');
      }
    }

    // Create LeadMagnet record (quiz is a type of lead magnet)
    const leadMagnet = await LeadMagnet.create({
      userId: req.user._id,
      brandId: brandId || undefined,
      sourceType: brand?.sourceType || 'website',
      sourceUrl: brand?.sourceUrl || '',
      goal: 'get_leads',
      type: 'quiz',
      tone: 'professional',
      title,
      slug,
      isPublished: false, // Draft until quiz is published
      isPublic: false,
      generationStatus: 'complete',
      landingStatus: 'ready',
      emailsStatus: 'ready',
    });

    const quiz = await Quiz.create({
      userId: req.user._id,
      brandId: brandId || undefined,
      leadMagnetId: leadMagnet._id,
      title,
      subtitle,
      coverImageUrl,
      slug,
      emailCapturePoint: emailCapturePoint || 'before_results',
      emailFields: emailFields || { requireEmail: true, requireName: false, requirePhone: false },
      privacyText,
      questions: questions || [],
      results: results || [],
      theme: theme || 'dark',
      primaryColor: primaryColor || '#10B981',
      accentColor: accentColor || '#6366F1',
      logoUrl,
      fontStyle: fontStyle || 'modern',
      status: 'draft',
    });

    // Link quiz back to lead magnet
    leadMagnet.quizId = quiz._id;
    await leadMagnet.save();

    logger.info('Quiz created', {
      userId: req.user._id,
      quizId: quiz._id,
      slug,
    });

    res.status(201).json({
      success: true,
      data: { quiz: quiz.toObject() as IQuiz },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get All Quizzes for User
// ============================================

export async function getAll(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quizzes: IQuiz[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const quizzes = await Quiz.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('responseCount');

    res.json({
      success: true,
      data: { quizzes: quizzes.map((q) => q.toObject() as IQuiz) },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Single Quiz
// ============================================

export async function getOne(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quiz: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    }).populate('responseCount');

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    res.json({
      success: true,
      data: { quiz: quiz.toObject() as IQuiz },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Update Quiz
// ============================================

export async function update(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quiz: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;
    const {
      title,
      subtitle,
      brandId,
      coverImageUrl,
      emailCapturePoint,
      emailFields,
      privacyText,
      questions,
      results,
      theme,
      primaryColor,
      accentColor,
      logoUrl,
      fontStyle,
    } = req.body;

    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Validate brandId if provided
    if (brandId) {
      const brand = await Brand.findOne({ _id: brandId, userId: req.user._id });
      if (!brand) {
        throw AppError.badRequest('Selected brand not found');
      }
    }

    // Update fields if provided
    if (title !== undefined) quiz.title = title;
    if (subtitle !== undefined) quiz.subtitle = subtitle;
    if (brandId !== undefined) quiz.brandId = brandId || undefined;
    if (coverImageUrl !== undefined) quiz.coverImageUrl = coverImageUrl;
    if (emailCapturePoint !== undefined) quiz.emailCapturePoint = emailCapturePoint;
    if (emailFields !== undefined) quiz.emailFields = emailFields;
    if (privacyText !== undefined) quiz.privacyText = privacyText;
    if (questions !== undefined) quiz.questions = questions;
    if (results !== undefined) quiz.results = results;
    if (theme !== undefined) quiz.theme = theme;
    if (primaryColor !== undefined) quiz.primaryColor = primaryColor;
    if (accentColor !== undefined) quiz.accentColor = accentColor;
    if (logoUrl !== undefined) quiz.logoUrl = logoUrl;
    if (fontStyle !== undefined) quiz.fontStyle = fontStyle;

    await quiz.save();

    logger.info('Quiz updated', {
      userId: req.user._id,
      quizId: quiz._id,
    });

    res.json({
      success: true,
      data: { quiz: quiz.toObject() as IQuiz },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Delete Quiz
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

    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Delete associated responses
    await QuizResponse.deleteMany({ quizId: id });

    // Delete associated lead magnet
    if (quiz.leadMagnetId) {
      await LeadMagnet.deleteOne({ _id: quiz.leadMagnetId });
    }

    // Delete the quiz
    await quiz.deleteOne();

    logger.info('Quiz deleted', {
      userId: req.user._id,
      quizId: id,
    });

    res.json({
      success: true,
      data: { message: 'Quiz deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Publish Quiz
// ============================================

export async function publish(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quiz: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Validate quiz has minimum requirements
    if (!quiz.questions || quiz.questions.length < 2) {
      throw AppError.badRequest('Quiz must have at least 2 questions to publish');
    }

    if (!quiz.results || quiz.results.length < 2) {
      throw AppError.badRequest('Quiz must have at least 2 results to publish');
    }

    // Check that all answers have result mappings
    const hasUnmappedAnswers = quiz.questions.some((q) =>
      q.answers.some((a) => !a.resultMapping)
    );

    if (hasUnmappedAnswers) {
      throw AppError.badRequest('All answers must be mapped to results before publishing');
    }

    quiz.status = 'published';
    await quiz.save();

    // Also publish the associated lead magnet
    if (quiz.leadMagnetId) {
      await LeadMagnet.updateOne(
        { _id: quiz.leadMagnetId },
        { isPublished: true }
      );
    }

    logger.info('Quiz published', {
      userId: req.user._id,
      quizId: quiz._id,
    });

    res.json({
      success: true,
      data: { quiz: quiz.toObject() as IQuiz },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Unpublish Quiz
// ============================================

export async function unpublish(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ quiz: IQuiz }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    quiz.status = 'draft';
    await quiz.save();

    // Also unpublish the associated lead magnet
    if (quiz.leadMagnetId) {
      await LeadMagnet.updateOne(
        { _id: quiz.leadMagnetId },
        { isPublished: false }
      );
    }

    logger.info('Quiz unpublished', {
      userId: req.user._id,
      quizId: quiz._id,
    });

    res.json({
      success: true,
      data: { quiz: quiz.toObject() as IQuiz },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Generate Questions (AI)
// ============================================

export async function generateQuestionsHandler(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ questions: IQuizQuestion[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { audience, goal, questionCount, niche, quizTitle } = req.body;

    if (!audience || !goal || !niche) {
      throw AppError.badRequest('Audience, goal, and niche are required');
    }

    const count = questionCount || 8;
    if (count < 4 || count > 15) {
      throw AppError.badRequest('Question count must be between 4 and 15');
    }

    logger.info('Generating quiz questions', {
      userId: req.user._id,
      audience,
      goal,
      questionCount: count,
    });

    const generated = await generateQuizQuestions({
      audience,
      goal,
      questionCount: count,
      niche,
      quizTitle,
    });

    // Convert to schema format with ObjectIds
    const questions = convertGeneratedQuestionsToSchema(generated.questions);

    // Add _id to each question
    const questionsWithIds = questions.map((q, index) => ({
      ...q,
      _id: new mongoose.Types.ObjectId(),
      order: index,
    })) as unknown as IQuizQuestion[];

    logger.info('Quiz questions generated', {
      userId: req.user._id,
      questionCount: questionsWithIds.length,
    });

    res.json({
      success: true,
      data: { questions: questionsWithIds },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Generate Results (AI)
// ============================================

export async function generateResultsHandler(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ results: IQuizResult[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { quizTitle, questions, resultCount, niche } = req.body;

    if (!quizTitle || !questions || !niche) {
      throw AppError.badRequest('Quiz title, questions, and niche are required');
    }

    const count = resultCount || 5;
    if (count < 2 || count > 8) {
      throw AppError.badRequest('Result count must be between 2 and 8');
    }

    logger.info('Generating quiz results', {
      userId: req.user._id,
      quizTitle,
      questionCount: questions.length,
      resultCount: count,
    });

    const generated = await generateQuizResults({
      quizTitle,
      questions,
      resultCount: count,
      niche,
    });

    // Convert to schema format with ObjectIds
    const results = convertGeneratedResultsToSchema(generated.results);

    // Add _id to each result
    const resultsWithIds = results.map((r) => ({
      ...r,
      _id: new mongoose.Types.ObjectId(),
    })) as unknown as IQuizResult[];

    logger.info('Quiz results generated', {
      userId: req.user._id,
      resultCount: resultsWithIds.length,
    });

    res.json({
      success: true,
      data: { results: resultsWithIds },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Generate Answer Mapping
// ============================================

export async function generateMappingHandler(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ questions: IQuizQuestion[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { questions, results } = req.body;

    if (!questions || !results) {
      throw AppError.badRequest('Questions and results are required');
    }

    if (results.length === 0) {
      throw AppError.badRequest('At least one result is required');
    }

    logger.info('Generating answer mapping', {
      userId: req.user._id,
      questionCount: questions.length,
      resultCount: results.length,
    });

    const mapping = generateAnswerMapping(questions, results);
    const mappedQuestions = applyAnswerMapping(questions, mapping);

    logger.info('Answer mapping generated', {
      userId: req.user._id,
      mappingCount: mapping.size,
    });

    res.json({
      success: true,
      data: { questions: mappedQuestions as IQuizQuestion[] },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Quiz Responses
// ============================================

export async function getResponses(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ responses: any[]; total: number }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    // Verify ownership
    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    const responses = await QuizResponse.find({ quizId: id })
      .sort({ createdAt: -1 })
      .limit(500);

    res.json({
      success: true,
      data: {
        responses: responses.map((r) => r.toObject()),
        total: responses.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Export Responses as CSV
// ============================================

export async function exportResponsesCsv(
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
    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    const responses = await QuizResponse.find({ quizId: id })
      .sort({ createdAt: -1 });

    // Build result name lookup
    const resultNameMap = new Map(
      quiz.results.map((r) => [r._id.toString(), r.name])
    );

    // Generate CSV
    const csvHeader = 'email,first_name,phone,result,completed_at,source\n';
    const csvRows = responses.map((resp) => {
      const resultName = resp.resultId
        ? resultNameMap.get(resp.resultId.toString()) || 'Unknown'
        : 'Incomplete';
      return `${resp.email || ''},"${resp.firstName || ''}","${resp.phone || ''}","${resultName}",${resp.completedAt?.toISOString() || ''},${resp.source || 'direct'}`;
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${quiz.slug}-responses.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Quiz Analytics
// ============================================

export async function getAnalytics(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    stats: {
      views: number;
      starts: number;
      completions: number;
      emailsCaptured: number;
      conversionRate: number;
      completionRate: number;
    };
    resultDistribution: Array<{
      resultId: string;
      resultName: string;
      count: number;
      percentage: number;
    }>;
    recentResponses: any[];
  }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    // Verify ownership
    const quiz = await Quiz.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!quiz) {
      throw AppError.notFound('Quiz not found');
    }

    // Get all responses with results
    const responsesWithResults = await QuizResponse.find({
      quizId: id,
      resultId: { $exists: true },
    }).select('resultId');

    const resultIds = responsesWithResults.map((r) =>
      r.resultId!.toString()
    );

    // Calculate result distribution
    const resultDistribution = getResultDistribution(resultIds, quiz);

    // Get recent responses
    const recentResponses = await QuizResponse.find({ quizId: id })
      .sort({ createdAt: -1 })
      .limit(10);

    // Calculate rates
    const { views, starts, completions, emailsCaptured } = quiz.stats;
    const conversionRate = views > 0 ? Math.round((emailsCaptured / views) * 100) : 0;
    const completionRate = starts > 0 ? Math.round((completions / starts) * 100) : 0;

    res.json({
      success: true,
      data: {
        stats: {
          views,
          starts,
          completions,
          emailsCaptured,
          conversionRate,
          completionRate,
        },
        resultDistribution,
        recentResponses: recentResponses.map((r) => r.toObject()),
      },
    });
  } catch (error) {
    next(error);
  }
}

