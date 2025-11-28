import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ApiResponse>,
  _next: NextFunction
): void {
  // Log the error
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Server error', {
        message: err.message,
        code: err.code,
        stack: err.stack,
      });
    } else {
      logger.warn('Client error', {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
      });
    }
  } else {
    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack,
    });
  }

  // Determine status code and message
  let statusCode = 500;
  let message = 'Internal server error';
  let code: string | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
  } else if (err.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    message = err.message;
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'CastError') {
    // Mongoose cast error (invalid ObjectId, etc.)
    statusCode = 400;
    message = 'Invalid ID format';
    code = 'INVALID_ID';
  } else if (err.name === 'MongoServerError' && (err as { code?: number }).code === 11000) {
    // Duplicate key error
    statusCode = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_KEY';
  }

  // Send response
  const response: ApiResponse = {
    success: false,
    error: message,
    code,
  };

  // Include stack trace in development
  if (config.isDev && !(err instanceof AppError && err.isOperational)) {
    (response as ApiResponse & { stack?: string }).stack = err.stack;
  }

  res.status(statusCode).json(response);
}

// Handle unhandled promise rejections
export function handleUnhandledRejection(reason: unknown): void {
  logger.error('Unhandled Promise Rejection', reason);
  // Don't exit the process, let the error handler deal with it
}

// Handle uncaught exceptions
export function handleUncaughtException(error: Error): void {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack,
  });
  // Exit with failure code
  process.exit(1);
}

