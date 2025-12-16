import OpenAI from 'openai';
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { IQuizQuestion, IQuizResult, IQuizAnswer } from '../types/index.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// ============================================
// Types
// ============================================

export interface QuizGenerationInput {
  audience: string;
  goal: string;
  questionCount: number;
  niche: string;
  quizTitle?: string;
}

export interface GeneratedQuestion {
  questionText: string;
  answers: string[];
}

export interface QuizQuestionsOutput {
  questions: GeneratedQuestion[];
}

export interface ResultsGenerationInput {
  quizTitle: string;
  questions: GeneratedQuestion[];
  resultCount: number;
  niche: string;
}

export interface GeneratedResult {
  name: string;
  emoji: string;
  summary: string;
  traits: string[];
  recommendation: string;
  suggestedCTA: string;
}

export interface QuizResultsOutput {
  results: GeneratedResult[];
}

export interface AnswerMapping {
  [answerId: string]: string; // answerId -> resultId
}

// ============================================
// Helper Functions
// ============================================

async function callOpenAI<T>(
  systemPrompt: string,
  userPrompt: string,
  retries = MAX_RETRIES,
  options?: { maxOutputTokens?: number }
): Promise<T> {
  try {
    // Combine system and user prompts for the Responses API
    const input = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input,
      ...(options?.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
      text: {
        format: {
          type: 'json_object',
        },
      },
    });

    const content = response.output_text;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Be tolerant of occasional stray text around the JSON object.
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? content.slice(firstBrace, lastBrace + 1)
        : content;

    try {
      return JSON.parse(jsonCandidate) as T;
    } catch (parseError) {
      // If output was truncated due to token limits, retry with a slightly higher cap.
      const looksTruncated =
        typeof content === 'string' &&
        content.includes('{') &&
        !content.trim().endsWith('}');

      if (looksTruncated && retries > 0 && options?.maxOutputTokens) {
        const bumped = Math.min(Math.round(options.maxOutputTokens * 1.4 + 200), 8000);
        logger.warn('OpenAI returned truncated JSON; retrying with higher max_output_tokens', {
          from: options.maxOutputTokens,
          to: bumped,
          retriesLeft: retries - 1,
        });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return callOpenAI<T>(systemPrompt, userPrompt, retries - 1, { ...options, maxOutputTokens: bumped });
      }

      logger.warn('Failed to parse OpenAI JSON output', {
        message: parseError instanceof Error ? parseError.message : String(parseError),
        preview: content.slice(0, 500),
      });
      throw parseError;
    }
  } catch (error) {
    if (retries > 0) {
      logger.warn('OpenAI call failed, retrying...', { retriesLeft: retries - 1 });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return callOpenAI<T>(systemPrompt, userPrompt, retries - 1, options);
    }

    logger.error('OpenAI call failed after retries', {
      message: error instanceof Error ? error.message : String(error),
      error,
    });
    throw AppError.internal('AI service temporarily unavailable. Please try again.');
  }
}

// ============================================
// Generate Quiz Questions
// ============================================

export async function generateQuizQuestions(
  input: QuizGenerationInput
): Promise<QuizQuestionsOutput> {
  logger.info('Generating quiz questions', { input });

  const systemPrompt = `You are an expert quiz designer specializing in personality quizzes that engage users and provide valuable insights.

Generate ${input.questionCount} multiple-choice questions for a personality quiz.

Context:
- Audience: ${input.audience}
- Goal: Help them ${input.goal}
- Niche: ${input.niche}
${input.quizTitle ? `- Quiz Title: ${input.quizTitle}` : ''}

Requirements:
- Each question should have exactly 4 answer options
- Questions should be engaging, not generic
- Answers should be distinct personality/preference indicators
- Vary question types (preferences, habits, goals, challenges, scenarios)
- Use conversational, friendly tone
- Questions should take 30 seconds or less to answer
- Avoid yes/no questions - make each answer reveal something about personality
- Make answers roughly equal in appeal (no obviously "right" answers)

Return as JSON:
{
  "questions": [
    {
      "questionText": "What's your ideal Saturday morning?",
      "answers": [
        "Sleeping in and relaxing",
        "Getting an early workout in",
        "Catching up on work",
        "Exploring something new"
      ]
    }
  ]
}`;

  const userPrompt = `Create ${input.questionCount} engaging personality quiz questions for:
Audience: ${input.audience}
Goal: ${input.goal}
Niche: ${input.niche}

Make sure questions reveal personality traits that can map to distinct result types.`;

  return callOpenAI<QuizQuestionsOutput>(systemPrompt, userPrompt, MAX_RETRIES, {
    maxOutputTokens: 4000,
  });
}

// ============================================
// Generate Quiz Results
// ============================================

export async function generateQuizResults(
  input: ResultsGenerationInput
): Promise<QuizResultsOutput> {
  logger.info('Generating quiz results', { 
    quizTitle: input.quizTitle, 
    resultCount: input.resultCount 
  });

  const questionsText = input.questions
    .map((q, i) => `${i + 1}. ${q.questionText}\n   Options: ${q.answers.join(' | ')}`)
    .join('\n');

  const systemPrompt = `You are an expert at creating engaging personality quiz results that feel personal and valuable.

Generate ${input.resultCount} distinct personality types for this quiz: "${input.quizTitle}"

Based on these questions:
${questionsText}

Each result should:
1. Have a catchy, relatable name (e.g., "The HIIT Hustler", "The Mindful Mover", "The Weekend Warrior")
2. Include an appropriate emoji that represents this personality
3. Have a 2-3 sentence summary that feels personal and validating (use "you" language)
4. List 4-5 key traits as bullet points
5. Include a helpful recommendation paragraph
6. Suggest a relevant call-to-action text

Niche context: ${input.niche}

Make each result distinct and equally appealing - no result should feel like "the bad one".

Return as JSON:
{
  "results": [
    {
      "name": "The HIIT Hustler",
      "emoji": "🏋️",
      "summary": "You thrive on high-intensity workouts that maximize your limited time. You love the endorphin rush and measurable progress that comes from pushing your limits.",
      "traits": ["Loves quick, intense workouts", "Gets bored with slow routines", "Motivated by visible results", "Thrives under pressure"],
      "recommendation": "Try my 15-minute HIIT program designed for busy professionals. You'll get maximum results in minimum time, perfect for your go-getter personality.",
      "suggestedCTA": "Get My Free HIIT Guide"
    }
  ]
}`;

  const userPrompt = `Create ${input.resultCount} distinct, engaging personality results for:
Quiz: ${input.quizTitle}
Niche: ${input.niche}

Make each result feel special and valuable to receive.`;

  return callOpenAI<QuizResultsOutput>(systemPrompt, userPrompt, MAX_RETRIES, {
    maxOutputTokens: 6000,
  });
}

// ============================================
// Generate Answer-to-Result Mapping
// ============================================

/**
 * Automatically assigns which answers lead to which results.
 * Uses a simple even distribution algorithm to ensure each result
 * has roughly equal paths to it.
 */
export function generateAnswerMapping(
  questions: IQuizQuestion[],
  results: IQuizResult[]
): Map<string, mongoose.Types.ObjectId> {
  const mapping = new Map<string, mongoose.Types.ObjectId>();
  const resultIds = results.map((r) => r._id);
  const resultCount = resultIds.length;

  if (resultCount === 0) {
    logger.warn('No results provided for answer mapping');
    return mapping;
  }

  // Track how many answers point to each result
  const resultAnswerCounts: Record<string, number> = {};
  resultIds.forEach((id) => {
    resultAnswerCounts[id.toString()] = 0;
  });

  // For each question, distribute answers across results as evenly as possible
  questions.forEach((question) => {
    question.answers.forEach((answer, answerIndex) => {
      // Assign to result in round-robin fashion
      const resultIndex = answerIndex % resultCount;
      const resultId = resultIds[resultIndex];
      
      if (resultId) {
        mapping.set(answer._id.toString(), resultId);
        resultAnswerCounts[resultId.toString()]++;
      }
    });
  });

  logger.info('Generated answer mapping', {
    totalMappings: mapping.size,
    distribution: resultAnswerCounts,
  });

  return mapping;
}

/**
 * Applies the generated mapping to the questions array,
 * updating the resultMapping field on each answer.
 */
export function applyAnswerMapping(
  questions: IQuizQuestion[],
  mapping: Map<string, mongoose.Types.ObjectId>
): IQuizQuestion[] {
  return questions.map((question) => ({
    ...question,
    answers: question.answers.map((answer) => ({
      ...answer,
      resultMapping: mapping.get(answer._id.toString()) || answer.resultMapping,
    })),
  }));
}

// ============================================
// Convert Generated Questions to Schema Format
// ============================================

export function convertGeneratedQuestionsToSchema(
  generated: GeneratedQuestion[]
): Omit<IQuizQuestion, '_id'>[] {
  return generated.map((q, index) => ({
    questionText: q.questionText,
    order: index,
    answers: q.answers.map((answerText) => ({
      _id: new mongoose.Types.ObjectId(),
      answerText,
      resultMapping: undefined,
    })) as unknown as IQuizAnswer[],
  }));
}

// ============================================
// Convert Generated Results to Schema Format
// ============================================

export function convertGeneratedResultsToSchema(
  generated: GeneratedResult[]
): Omit<IQuizResult, '_id'>[] {
  return generated.map((r) => ({
    name: r.name,
    emoji: r.emoji,
    summary: r.summary,
    traits: r.traits,
    recommendation: r.recommendation,
    ctaText: r.suggestedCTA,
    ctaUrl: undefined,
    imageUrl: undefined,
  }));
}

