import type { Response, NextFunction } from 'express';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';
import type { AuthenticatedRequest } from '../types/index.js';

/**
 * Rate limiting middleware for lead magnet generation
 * Limits users to X free generations per day
 */
export async function checkGenerationLimit(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // Get start of today (UTC)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Count generations today
    const generationsToday = await LeadMagnet.countDocuments({
      userId: req.user._id,
      createdAt: { $gte: startOfDay },
    });

    if (generationsToday >= config.rateLimit.freeGenerationsPerDay) {
      throw AppError.tooManyRequests(
        `You've reached your daily limit of ${config.rateLimit.freeGenerationsPerDay} free generation(s). Upgrade for unlimited access.`,
        'RATE_LIMIT_EXCEEDED'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Get remaining generations for user today
 */
export async function getRemainingGenerations(userId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const generationsToday = await LeadMagnet.countDocuments({
    userId,
    createdAt: { $gte: startOfDay },
  });

  return Math.max(0, config.rateLimit.freeGenerationsPerDay - generationsToday);
}

