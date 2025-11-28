import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/AppError.js';

type ValidationTarget = 'body' | 'query' | 'params';

interface ValidationOptions {
  target?: ValidationTarget;
}

/**
 * Middleware factory to validate request data using Zod schemas
 */
export function validate<T extends z.ZodType>(
  schema: T,
  options: ValidationOptions = {}
) {
  const { target = 'body' } = options;

  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = req[target];
      const result = schema.safeParse(data);

      if (!result.success) {
        const errors = result.error.errors.map((err) => {
          const path = err.path.join('.');
          return path ? `${path}: ${err.message}` : err.message;
        });

        throw AppError.badRequest(
          `Validation failed: ${errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Replace request data with parsed (and potentially transformed) data
      req[target] = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate request body
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return validate(schema, { target: 'body' });
}

/**
 * Validate request query parameters
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return validate(schema, { target: 'query' });
}

/**
 * Validate request URL parameters
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return validate(schema, { target: 'params' });
}

