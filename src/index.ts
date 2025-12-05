import app from './app.js';
import { config, validateConfig } from './config/index.js';
import { connectDatabase } from './utils/database.js';
import { logger } from './utils/logger.js';
import { handleUnhandledRejection, handleUncaughtException } from './middleware/errorHandler.js';
import { initSentry } from './utils/sentry.js';

// Initialize Sentry FIRST (before anything else)
initSentry();

// Handle uncaught errors
process.on('unhandledRejection', (reason) => {
  handleUnhandledRejection(reason).catch((error) => {
    logger.error('Error in unhandled rejection handler:', error);
  });
});
process.on('uncaughtException', (error) => {
  handleUncaughtException(error).catch((slackError) => {
    logger.error('Error in uncaught exception handler:', slackError);
    // Still exit even if Slack notification fails
    process.exit(1);
  });
});

async function bootstrap(): Promise<void> {
  try {
    // Validate configuration
    validateConfig();
    logger.info('✅ Configuration validated');

    // Connect to database
    await connectDatabase();

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`🚀 MagnetHub API running on port ${config.port}`);
      logger.info(`📍 Environment: ${config.nodeEnv}`);
      logger.info(`🌐 Client URL: ${config.clientUrl}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          const { disconnectDatabase } = await import('./utils/database.js');
          await disconnectDatabase();
          logger.info('Database connection closed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', error);
          process.exit(1);
        }
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

bootstrap();

