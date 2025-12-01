import type { Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { billingService } from '../services/billingService.js';
import type { AuthenticatedRequest } from '../types/index.js';

/**
 * Rate limiting middleware for lead magnet generation
 * Checks user's subscription plan and usage limits
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

    // Check if user can create a lead magnet based on their subscription
    const { allowed, reason } = await billingService.canUserCreateLeadMagnet(req.user._id.toString());

    if (!allowed) {
      throw AppError.tooManyRequests(
        reason || 'You have reached your lead magnet limit. Please upgrade your plan.',
        'LIMIT_EXCEEDED'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Get remaining lead magnets for user
 */
export async function getRemainingGenerations(userId: string): Promise<number> {
  const status = await billingService.getUserSubscriptionStatus(userId);
  return status.leadMagnetsRemaining ?? 0;
}

