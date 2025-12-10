import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

export async function connectDatabase(retries = MAX_RETRIES): Promise<void> {
  try {
    logger.info('Connecting to MongoDB...', { uri: config.mongoUri.replace(/\/\/.*@/, '//<credentials>@') });

    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info('✅ MongoDB connected successfully at ', config.mongoUri);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

  } catch (error) {
    logger.error('Failed to connect to MongoDB', error);

    if (retries > 0) {
      logger.info(`Retrying connection in ${RETRY_DELAY / 1000}s... (${retries} attempts remaining)`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return connectDatabase(retries - 1);
    }

    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB', error);
    throw error;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

