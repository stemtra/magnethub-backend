import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';

/**
 * Middleware to check if user is authenticated
 */
export function isAuthenticated(
  req: Request,
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
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // User will be available if authenticated, undefined otherwise
  next();
}

