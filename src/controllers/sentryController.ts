import type { Request, Response } from 'express';
import { SlackService } from '../services/slackService.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/**
 * Simple endpoint to receive error notifications from frontend and send to Slack
 */
export async function notifySlackError(req: Request, res: Response): Promise<void> {
  try {
    const errorData = req.body;

    // Only send notifications in production
    if (!config.isProd) {
      res.json({ received: true, environment: 'development' });
      return;
    }

    const { message, stack, url, userAgent, userId, timestamp, app = 'client' } = errorData;

    logger.info('Received frontend error notification', { message, url, userId });

    // Format error for Slack
    const errorMessage = `🚨 Frontend Error`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚨 Frontend Error*\n\n*Message:* ${message || 'Unknown error'}\n*URL:* ${url || 'N/A'}\n*User Agent:* ${userAgent || 'N/A'}\n*User ID:* ${userId || 'N/A'}\n*Time:* ${timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString()}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stack Trace:*\n\`\`\`${stack?.substring(0, 500)}${stack && stack.length > 500 ? '...' : ''}\`\`\``
        }
      }
    ];

    // Send to Slack
    await SlackService.sendProductionNotification(errorMessage, blocks);

    logger.info('Frontend error notification sent to Slack');

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing frontend error notification:', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
