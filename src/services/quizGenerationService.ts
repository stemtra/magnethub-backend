import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { IBrand } from '../types/index.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// ============================================
// Types
// ============================================

export interface GeneratedQuizAnswer {
  answerText: string;
  resultIndex: number; // Which result (0-indexed) this answer points to
}

export interface GeneratedQuizQuestion {
  questionText: string;
  answers: GeneratedQuizAnswer[];
}

export interface GeneratedQuizResult {
  name: string;
  emoji: string;
  summary: string;
  traits: string[];
  recommendation: string;
}

export interface GeneratedQuiz {
  title: string;
  subtitle: string;
  questions: GeneratedQuizQuestion[];
  results: GeneratedQuizResult[];
}

export interface QuizGenerationOptions {
  topic: string;
  brand: IBrand;
  numQuestions: number;
  numResults: number;
}

// ============================================
// Generate Quiz
// ============================================

/**
 * Generates a complete quiz based on topic and brand context
 */
export async function generateQuiz(options: QuizGenerationOptions): Promise<GeneratedQuiz> {
  const { topic, brand, numQuestions, numResults } = options;

  logger.info('Starting quiz generation', {
    topic,
    brandId: brand._id,
    brandName: brand.name,
    numQuestions,
    numResults,
  });

  // Build brand context prompt
  const brandContext = buildBrandContext(brand);

  const systemPrompt = `You are an expert quiz creator specializing in personality/assessment quizzes for lead generation.

Create an engaging, insightful quiz that:
1. Aligns with the brand's voice and values
2. Provides value to the target audience
3. Segments quiz-takers into distinct results/personas
4. Encourages email capture to see results

QUIZ STRUCTURE:
- Each question should have ${Math.max(2, Math.min(4, numResults))} answer options
- Each answer maps to one of the ${numResults} result types
- Questions should be thoughtful, not trivial
- Results should feel personalized and actionable
- Use emojis thoughtfully in results to add personality

BRAND ALIGNMENT:
- Match the brand's tone (${brand.brandVoice || 'professional'})
- Reference relevant products/services subtly in recommendations
- Target the brand's ideal audience

Return a JSON object with this exact structure:
{
  "title": "Engaging quiz title (question format works best)",
  "subtitle": "Brief description of what quiz-takers will discover",
  "questions": [
    {
      "questionText": "Question text here?",
      "answers": [
        { "answerText": "Answer option", "resultIndex": 0 },
        { "answerText": "Answer option", "resultIndex": 1 }
      ]
    }
  ],
  "results": [
    {
      "name": "Result Type Name",
      "emoji": "🎯",
      "summary": "2-3 sentence description of this persona/result",
      "traits": ["trait 1", "trait 2", "trait 3"],
      "recommendation": "Personalized recommendation or next step relevant to brand"
    }
  ]
}`;

  const userPrompt = `Create a ${numQuestions}-question quiz about: "${topic}"

${brandContext}

Generate ${numQuestions} questions and ${numResults} distinct result types.

Ensure:
- Questions flow naturally and build on each other
- Answers are distributed across all results (not always result 0)
- Results are meaningfully different from each other
- Recommendations tie back to the brand's offerings`;

  try {
    const input = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    
    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input,
      max_output_tokens: 4000,
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

    // Parse JSON
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? content.slice(firstBrace, lastBrace + 1)
        : content;

    const generated = JSON.parse(jsonCandidate) as GeneratedQuiz;

    // Validate structure
    validateGeneratedQuiz(generated, numQuestions, numResults);

    logger.info('Quiz generation successful', {
      questionsGenerated: generated.questions.length,
      resultsGenerated: generated.results.length,
      title: generated.title,
    });

    return generated;
  } catch (error) {
    logger.error('Quiz generation failed', {
      error: error instanceof Error ? error.message : String(error),
      topic,
      brandId: brand._id,
    });

    throw new AppError(
      `Failed to generate quiz: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      'QUIZ_GENERATION_FAILED'
    );
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build brand context string for the prompt
 */
function buildBrandContext(brand: IBrand): string {
  const parts: string[] = [];

  parts.push(`BRAND: ${brand.name}`);
  
  if (brand.description) {
    parts.push(`Description: ${brand.description}`);
  }
  
  if (brand.brandVoice) {
    parts.push(`Voice: ${brand.brandVoice}`);
  }
  
  if (brand.targetAudience) {
    parts.push(`Target Audience: ${brand.targetAudience}`);
  }
  
  if (brand.keyMessages && brand.keyMessages.length > 0) {
    parts.push(`Key Messages: ${brand.keyMessages.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Validate the generated quiz structure
 */
function validateGeneratedQuiz(quiz: any, expectedQuestions: number, expectedResults: number): void {
  if (!quiz.title || typeof quiz.title !== 'string') {
    throw new Error('Invalid quiz: missing or invalid title');
  }

  if (!quiz.subtitle || typeof quiz.subtitle !== 'string') {
    throw new Error('Invalid quiz: missing or invalid subtitle');
  }

  if (!Array.isArray(quiz.questions) || quiz.questions.length !== expectedQuestions) {
    throw new Error(`Invalid quiz: expected ${expectedQuestions} questions, got ${quiz.questions?.length || 0}`);
  }

  if (!Array.isArray(quiz.results) || quiz.results.length !== expectedResults) {
    throw new Error(`Invalid quiz: expected ${expectedResults} results, got ${quiz.results?.length || 0}`);
  }

  // Validate questions
  quiz.questions.forEach((q: any, idx: number) => {
    if (!q.questionText || typeof q.questionText !== 'string') {
      throw new Error(`Invalid question ${idx}: missing or invalid questionText`);
    }

    if (!Array.isArray(q.answers) || q.answers.length < 2) {
      throw new Error(`Invalid question ${idx}: must have at least 2 answers`);
    }

    q.answers.forEach((a: any, aIdx: number) => {
      if (!a.answerText || typeof a.answerText !== 'string') {
        throw new Error(`Invalid answer ${aIdx} in question ${idx}: missing or invalid answerText`);
      }

      if (typeof a.resultIndex !== 'number' || a.resultIndex < 0 || a.resultIndex >= expectedResults) {
        throw new Error(`Invalid answer ${aIdx} in question ${idx}: resultIndex must be between 0 and ${expectedResults - 1}`);
      }
    });
  });

  // Validate results
  quiz.results.forEach((r: any, idx: number) => {
    if (!r.name || typeof r.name !== 'string') {
      throw new Error(`Invalid result ${idx}: missing or invalid name`);
    }

    if (!r.summary || typeof r.summary !== 'string') {
      throw new Error(`Invalid result ${idx}: missing or invalid summary`);
    }

    if (!Array.isArray(r.traits)) {
      throw new Error(`Invalid result ${idx}: traits must be an array`);
    }
  });
}

