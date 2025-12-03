import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  blocks?: any[];
}

export class SlackService {

  /**
   * Send a webhook message to the magnethub-production Slack channel
   */
  static async sendProductionNotification(text: string, blocks?: any[]): Promise<void> {
    const webhookUrl = config.slack.webhookMagnethubProduction;

    if (!webhookUrl) {
      logger.warn('Slack webhook URL for magnethub-production not configured - skipping notification');
      return;
    }

    const message: SlackMessage = {
      text,
      username: 'MagnetHub Bot',
      icon_emoji: ':magnet:',
      blocks,
    };

    try {
      logger.info(`Attempting to send Slack notification: ${text}`);
      await this.sendSlackWebhook(webhookUrl, message);
      logger.info('Slack notification sent successfully to magnethub-production channel');
    } catch (error) {
      logger.error('Failed to send Slack notification:', error as Error);
      // Log the webhook URL (masked) for debugging
      logger.error(`Webhook URL configured: ${webhookUrl ? 'Yes (starts with ' + webhookUrl.substring(0, 30) + '...)' : 'No'}`);
    }
  }

  /**
   * Send notification for new user registration
   */
  static async sendNewUserNotification(userEmail: string, userName: string): Promise<void> {
    const message = '🎉 New user signed up!';
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎉 New User Signup*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for new subscription (first time)
   */
  static async sendNewSubscriptionNotification(userEmail: string, userName: string, plan: string, billingInterval: string, amount: number): Promise<void> {
    // Amount comes in cents from Stripe, convert to dollars
    const amountInDollars = (amount / 100).toFixed(2);
    const message = `💰 New Subscription - $${amountInDollars}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💰 New Subscription*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Plan:* ${plan.toUpperCase()}\n*Billing:* ${billingInterval}\n*Amount:* $${amountInDollars}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    logger.info(`Sending new subscription notification for ${userEmail}, plan: ${plan}, amount: $${amountInDollars}`);
    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for plan change
   */
  static async sendPlanChangeNotification(userEmail: string, userName: string, oldPlan: string, newPlan: string): Promise<void> {
    const message = `⬆️ Plan Changed - ${oldPlan} to ${newPlan}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⬆️ Plan Changed*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*From:* ${oldPlan.toUpperCase()}\n*To:* ${newPlan.toUpperCase()}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for recurring payment success
   */
  static async sendRecurringPaymentNotification(userEmail: string, userName: string, amount: number, billingInterval: string): Promise<void> {
    const message = `💰 Recurring Payment Received - $${(amount / 100).toFixed(2)}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💰 Recurring Payment Succeeded*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Amount:* $${(amount / 100).toFixed(2)}\n*Billing:* ${billingInterval}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for payment failure
   */
  static async sendPaymentFailedNotification(userEmail: string, userName: string, amount: number, reason?: string): Promise<void> {
    const message = `⚠️ Payment Failed - $${(amount / 100).toFixed(2)}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Payment Failed*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Amount:* $${(amount / 100).toFixed(2)}${reason ? `\n*Reason:* ${reason}` : ''}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for subscription cancellation
   */
  static async sendSubscriptionCancelledNotification(userEmail: string, userName: string, plan: string, reason?: string): Promise<void> {
    const message = `❌ Subscription Cancelled - ${plan}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*❌ Subscription Cancelled*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Plan:* ${plan.toUpperCase()}${reason ? `\n*Reason:* ${reason}` : ''}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Send notification for subscription reactivation
   */
  static async sendSubscriptionReactivatedNotification(userEmail: string, userName: string, plan: string): Promise<void> {
    const message = `✅ Subscription Reactivated - ${plan}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*✅ Subscription Reactivated*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Plan:* ${plan.toUpperCase()}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendProductionNotification(message, blocks);
  }

  /**
   * Generic method to send a webhook to Slack
   */
  private static async sendSlackWebhook(webhookUrl: string, message: SlackMessage): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Slack webhook failed with status ${response.status}: ${response.statusText}. Response: ${responseText}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Slack webhook error: ${error.message}`);
      }
      throw error;
    }
  }
}
