import type { IQuiz, IQuizResult } from '../types/index.js';
import { logger } from './logger.js';

// Interface for answer input (can be string or ObjectId-like)
interface AnswerInput {
  questionId: string | { toString(): string };
  answerId: string | { toString(): string };
}

/**
 * Calculates which quiz result a user should receive based on their answers.
 * 
 * Algorithm:
 * 1. For each answer the user gave, look up which result it maps to
 * 2. Tally up the count for each result
 * 3. Return the result with the highest count
 * 4. In case of a tie, return the first result (by order in the results array)
 * 
 * @param responses - Array of user's answers (questionId + answerId pairs)
 * @param quiz - The quiz document with questions and results
 * @returns The winning result, or null if no valid result found
 */
export function calculateQuizResult(
  responses: AnswerInput[],
  quiz: IQuiz
): IQuizResult | null {
  if (!quiz.results || quiz.results.length === 0) {
    logger.warn('Quiz has no results defined', { quizId: quiz._id });
    return null;
  }

  if (!responses || responses.length === 0) {
    logger.warn('No responses provided for result calculation', { quizId: quiz._id });
    return null;
  }

  // Count which result each answer points to
  const resultScores: Record<string, number> = {};

  // Initialize all results with 0
  quiz.results.forEach((result) => {
    resultScores[result._id.toString()] = 0;
  });

  // Tally up scores based on answers
  responses.forEach((response) => {
    // Find the question
    const question = quiz.questions.find(
      (q) => q._id.toString() === response.questionId.toString()
    );

    if (!question) {
      logger.warn('Question not found for response', {
        quizId: quiz._id,
        questionId: response.questionId,
      });
      return;
    }

    // Find the answer
    const answer = question.answers.find(
      (a) => a._id.toString() === response.answerId.toString()
    );

    if (!answer) {
      logger.warn('Answer not found for response', {
        quizId: quiz._id,
        questionId: response.questionId,
        answerId: response.answerId,
      });
      return;
    }

    // Increment the score for the mapped result
    if (answer.resultMapping) {
      const resultId = answer.resultMapping.toString();
      if (resultScores[resultId] !== undefined) {
        resultScores[resultId]++;
      }
    }
  });

  logger.debug('Quiz result scores', {
    quizId: quiz._id,
    scores: resultScores,
    responseCount: responses.length,
  });

  // Find the winning result
  let winningResultId: string | null = null;
  let highestScore = -1;

  // Iterate in order of results array (for deterministic tie-breaking)
  quiz.results.forEach((result) => {
    const resultId = result._id.toString();
    const score = resultScores[resultId] || 0;

    if (score > highestScore) {
      highestScore = score;
      winningResultId = resultId;
    }
  });

  if (!winningResultId) {
    // Fallback to first result if no scores (shouldn't happen normally)
    logger.warn('No winning result found, falling back to first result', {
      quizId: quiz._id,
    });
    return quiz.results[0] || null;
  }

  const winningResult = quiz.results.find(
    (r) => r._id.toString() === winningResultId
  );

  logger.info('Quiz result calculated', {
    quizId: quiz._id,
    winningResultId,
    winningResultName: winningResult?.name,
    score: highestScore,
    totalQuestions: responses.length,
  });

  return winningResult || null;
}

/**
 * Validates that the user has answered all required questions.
 * 
 * @param responses - Array of user's answers
 * @param quiz - The quiz document
 * @returns Object with isValid flag and any missing question IDs
 */
export function validateQuizResponses(
  responses: AnswerInput[],
  quiz: IQuiz
): { isValid: boolean; missingQuestions: string[] } {
  const answeredQuestionIds = new Set(
    responses.map((r) => r.questionId.toString())
  );

  const missingQuestions: string[] = [];

  quiz.questions.forEach((question) => {
    if (!answeredQuestionIds.has(question._id.toString())) {
      missingQuestions.push(question._id.toString());
    }
  });

  return {
    isValid: missingQuestions.length === 0,
    missingQuestions,
  };
}

/**
 * Gets the distribution of results across all responses.
 * Useful for analytics to show "most common result".
 * 
 * @param resultIds - Array of result IDs from quiz responses
 * @param quiz - The quiz document
 * @returns Array of results with their counts and percentages
 */
export function getResultDistribution(
  resultIds: string[],
  quiz: IQuiz
): Array<{
  resultId: string;
  resultName: string;
  count: number;
  percentage: number;
}> {
  const totalResponses = resultIds.length;

  if (totalResponses === 0) {
    return quiz.results.map((result) => ({
      resultId: result._id.toString(),
      resultName: result.name,
      count: 0,
      percentage: 0,
    }));
  }

  // Count occurrences of each result
  const counts: Record<string, number> = {};
  resultIds.forEach((id) => {
    counts[id] = (counts[id] || 0) + 1;
  });

  return quiz.results.map((result) => {
    const resultId = result._id.toString();
    const count = counts[resultId] || 0;
    const percentage = Math.round((count / totalResponses) * 100);

    return {
      resultId,
      resultName: result.name,
      count,
      percentage,
    };
  });
}

