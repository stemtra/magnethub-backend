import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { ApiResponse } from '../types/index.js';
import { captureError, addBreadcrumb, Sentry } from '../utils/sentry.js';
import { SlackService } from '../services/slackService.js';

/**
 * Send error notification to Slack
 */
async function notifySlackError(
  error: Error,
  context: { type: string; path?: string; method?: string; userId?: string }
): Promise<void> {
  try {
    if (!config.isProd) return; // Only send notifications in production

    const { type, path, method, userId } = context;
    const errorMessage = `🚨 Backend ${type.charAt(0).toUpperCase() + type.slice(1)} Error`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚨 Backend Error*\n\n*Type:* ${type}\n*Message:* ${error.message}\n*Path:* ${path || 'N/A'}\n*Method:* ${method || 'N/A'}\n*User ID:* ${userId || 'N/A'}\n*Time:* ${new Date().toLocaleString()}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stack Trace:*\n\`\`\`${error.stack?.substring(0, 500)}${error.stack && error.stack.length > 500 ? '...' : ''}\`\`\``
        }
      }
    ];

    await SlackService.sendProductionNotification(errorMessage, blocks);
  } catch (slackError) {
    logger.error('Failed to send Slack error notification:', slackError);
  }
}

export async function errorHandler(
  err: Error,
  req: Request,
  res: Response<ApiResponse>,
  _next: NextFunction
): Promise<void> {
  // Log the error
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Server error', {
        message: err.message,
        code: err.code,
        stack: err.stack,
      });
      // Capture 5xx errors to Sentry
      addBreadcrumb('request', `${req.method} ${req.path}`, {
        query: req.query,
        userId: (req.user as { id?: string })?.id,
      });
      captureError(err, {
        code: err.code,
        path: req.path,
        method: req.method,
      });
      // Send Slack notification for server errors
      await notifySlackError(err, {
        type: 'server',
        path: req.path,
        method: req.method,
        userId: (req.user as { id?: string })?.id,
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
    // Capture unhandled errors to Sentry
    addBreadcrumb('request', `${req.method} ${req.path}`);
    captureError(err, {
      path: req.path,
      method: req.method,
    });
    // Send Slack notification for unhandled errors
    await notifySlackError(err, {
      type: 'unhandled',
      path: req.path,
      method: req.method,
      userId: (req.user as { id?: string })?.id,
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
export async function handleUnhandledRejection(reason: unknown): Promise<void> {
  logger.error('Unhandled Promise Rejection', reason);

  // Send Slack notification
  const error = reason instanceof Error ? reason : new Error(String(reason));
  await notifySlackError(error, { type: 'unhandledRejection' });

  // Capture to Sentry
  captureError(reason, { type: 'unhandledRejection' });
  // Don't exit the process, let the error handler deal with it
}

// Handle uncaught exceptions
export async function handleUncaughtException(error: Error): Promise<void> {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack,
  });

  // Send Slack notification before exiting
  await notifySlackError(error, { type: 'uncaughtException' });

  // Capture to Sentry and flush before exiting
  captureError(error, { type: 'uncaughtException' });

  // Give Sentry time to send the error before exiting (only in production)
  if (config.isProd) {
    Sentry.close(2000).then(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
}

