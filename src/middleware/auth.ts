import type { Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedRequest } from '../types/index.js';

/**
 * Middleware to check if user is authenticated
 */
export function isAuthenticated(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }

  throw AppError.unauthorized('Please log in to access this resource');
}

/**
 * Middleware to optionally load user if authenticated
 * Does not throw error if not authenticated
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  // User will be available if authenticated, undefined otherwise
  next();
}

