import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  blocks?: any[];
}

type SlackWebhookType = 
  | 'productionUsers'
  | 'suggestions'
  | 'newCustomer'
  | 'customerReturned'
  | 'recurringPayment'
  | 'paymentFailed'
  | 'cancelledSubscription';

export class SlackService {

  /**
   * Get the webhook URL for a specific channel type
   */
  private static getWebhookUrl(type: SlackWebhookType): string {
    switch (type) {
      case 'productionUsers':
        return config.slack.webhookProductionUsers;
      case 'suggestions':
        return config.slack.webhookSuggestions;
      case 'newCustomer':
        return config.slack.webhookNewCustomer;
      case 'customerReturned':
        return config.slack.webhookCustomerReturned;
      case 'recurringPayment':
        return config.slack.webhookRecurringPayment;
      case 'paymentFailed':
        return config.slack.webhookPaymentFailed;
      case 'cancelledSubscription':
        return config.slack.webhookCancelledSubscription;
      default:
        return '';
    }
  }

  /**
   * Send a notification to a specific Slack channel
   */
  private static async sendToChannel(
    type: SlackWebhookType,
    text: string,
    blocks?: any[]
  ): Promise<void> {
    const webhookUrl = this.getWebhookUrl(type);

    if (!webhookUrl) {
      logger.warn(`Slack webhook URL for ${type} not configured - skipping notification`);
      return;
    }

    const message: SlackMessage = {
      text,
      username: 'MagnetHub Bot',
      icon_emoji: ':magnet:',
      blocks,
    };

    try {
      logger.info(`Sending Slack notification to ${type}: ${text}`);
      await this.sendSlackWebhook(webhookUrl, message);
      logger.info(`Slack notification sent successfully to ${type} channel`);
    } catch (error) {
      logger.error(`Failed to send Slack notification to ${type}:`, error as Error);
    }
  }

  /**
   * Send a general production notification (for new users, errors, etc.)
   */
  static async sendProductionNotification(text: string, blocks?: any[]): Promise<void> {
    await this.sendToChannel('productionUsers', text, blocks);
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

    await this.sendToChannel('productionUsers', message, blocks);
  }

  /**
   * Send notification for new subscription (first time customer)
   */
  static async sendNewSubscriptionNotification(
    userEmail: string,
    userName: string,
    plan: string,
    billingInterval: string,
    amount: number
  ): Promise<void> {
    // Amount comes in cents from Stripe, convert to dollars
    const amountInDollars = (amount / 100).toFixed(2);
    const message = `💰 New Customer - $${amountInDollars}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💰 New Customer*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Plan:* ${plan.toUpperCase()}\n*Billing:* ${billingInterval}\n*Amount:* $${amountInDollars}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    logger.info(`Sending new customer notification for ${userEmail}, plan: ${plan}, amount: $${amountInDollars}`);
    await this.sendToChannel('newCustomer', message, blocks);
  }

  /**
   * Send notification for plan change (upgrade/downgrade)
   */
  static async sendPlanChangeNotification(
    userEmail: string,
    userName: string,
    oldPlan: string,
    newPlan: string
  ): Promise<void> {
    const isUpgrade = this.isPlanUpgrade(oldPlan, newPlan);
    const emoji = isUpgrade ? '⬆️' : '⬇️';
    const action = isUpgrade ? 'Upgraded' : 'Downgraded';
    const message = `${emoji} Plan ${action} - ${oldPlan} → ${newPlan}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${emoji} Plan ${action}*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*From:* ${oldPlan.toUpperCase()}\n*To:* ${newPlan.toUpperCase()}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    // Upgrades go to newCustomer channel (positive revenue), downgrades to cancelledSubscription
    const channel: SlackWebhookType = isUpgrade ? 'newCustomer' : 'cancelledSubscription';
    await this.sendToChannel(channel, message, blocks);
  }

  /**
   * Check if plan change is an upgrade
   */
  private static isPlanUpgrade(oldPlan: string, newPlan: string): boolean {
    const planRank: Record<string, number> = {
      free: 0,
      starter: 1,
      pro: 2,
      agency: 3,
    };
    return (planRank[newPlan.toLowerCase()] || 0) > (planRank[oldPlan.toLowerCase()] || 0);
  }

  /**
   * Send notification for recurring payment success
   */
  static async sendRecurringPaymentNotification(
    userEmail: string,
    userName: string,
    amount: number,
    billingInterval: string
  ): Promise<void> {
    const amountInDollars = (amount / 100).toFixed(2);
    const message = `💵 Recurring Payment - $${amountInDollars}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💵 Recurring Payment Received*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Amount:* $${amountInDollars}\n*Billing:* ${billingInterval}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendToChannel('recurringPayment', message, blocks);
  }

  /**
   * Send notification for payment failure
   */
  static async sendPaymentFailedNotification(
    userEmail: string,
    userName: string,
    amount: number,
    reason?: string
  ): Promise<void> {
    const amountInDollars = (amount / 100).toFixed(2);
    const message = `⚠️ Payment Failed - $${amountInDollars}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Payment Failed*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Amount:* $${amountInDollars}${reason ? `\n*Reason:* ${reason}` : ''}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendToChannel('paymentFailed', message, blocks);
  }

  /**
   * Send notification for subscription cancellation
   */
  static async sendSubscriptionCancelledNotification(
    userEmail: string,
    userName: string,
    plan: string,
    reason?: string
  ): Promise<void> {
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

    await this.sendToChannel('cancelledSubscription', message, blocks);
  }

  /**
   * Send notification for subscription reactivation (returning customer)
   */
  static async sendSubscriptionReactivatedNotification(
    userEmail: string,
    userName: string,
    plan: string
  ): Promise<void> {
    const message = `🔄 Customer Returned - ${plan}`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🔄 Customer Returned*\n\n*Name:* ${userName}\n*Email:* ${userEmail}\n*Plan:* ${plan.toUpperCase()}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendToChannel('customerReturned', message, blocks);
  }

  /**
   * Send notification for user feedback/suggestions
   */
  static async sendFeedbackNotification(
    category: string | undefined,
    feedback: string,
    userEmail?: string
  ): Promise<void> {
    const categoryEmoji = category ? this.getCategoryEmoji(category) : '💬';
    const message = `${categoryEmoji} New Feedback Received`;
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${categoryEmoji} New User Feedback*\n\n${category ? `*Category:* ${this.formatCategory(category)}\n` : ''}${userEmail ? `*User:* ${userEmail}\n` : ''}*Feedback:* ${feedback}\n*Time:* ${new Date().toLocaleString()}`
        }
      }
    ];

    await this.sendToChannel('suggestions', message, blocks);
  }

  /**
   * Send notification for Sentry errors (backend)
   */
  static async sendSentryErrorNotification(
    error: any,
    app: 'backend' | 'client' = 'backend'
  ): Promise<void> {
    const appName = app === 'backend' ? 'Backend' : 'Client';
    const message = `🚨 ${appName} Error - ${error.title || 'Unknown Error'}`;

    // Extract relevant error information
    const errorMessage = error.message || error.exception?.values?.[0]?.value || 'No message available';
    const errorType = error.exception?.values?.[0]?.type || 'Unknown Type';
    const stackTrace = error.exception?.values?.[0]?.stacktrace?.frames?.slice(-3) || [];

    // Format stack trace for Slack
    const stackText = stackTrace.length > 0
      ? stackTrace.map((frame: any) => `• ${frame.filename}:${frame.lineno} in ${frame.function || 'unknown'}`).join('\n')
      : 'No stack trace available';

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🚨 ${appName} Error Detected*\n\n*Type:* ${errorType}\n*Message:* ${errorMessage}\n*Environment:* ${error.environment || 'Unknown'}\n*Time:* ${new Date(error.timestamp * 1000).toLocaleString()}\n*URL:* ${error.url || 'N/A'}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stack Trace (last 3 frames):*\n${stackText}`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Sentry'
            },
            url: error.web_url || `https://sentry.io/issues/${error.id}`
          }
        ]
      }
    ];

    await this.sendToChannel('productionUsers', message, blocks);
  }

  /**
   * Send notification for Sentry issues (aggregated errors)
   */
  static async sendSentryIssueNotification(
    issue: any,
    app: 'backend' | 'client' = 'backend'
  ): Promise<void> {
    const appName = app === 'backend' ? 'Backend' : 'Client';
    const level = issue.level || 'error';
    const levelEmoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';

    const message = `${levelEmoji} ${appName} Issue - ${issue.title}`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${levelEmoji} ${appName} Issue Alert*\n\n*Title:* ${issue.title}\n*Level:* ${level}\n*Environment:* ${issue.environment || 'Unknown'}\n*Project:* ${issue.project?.name || 'Unknown'}\n*First Seen:* ${new Date(issue.firstSeen).toLocaleString()}\n*Last Seen:* ${new Date(issue.lastSeen).toLocaleString()}\n*Events:* ${issue.count || 0}`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Issue'
            },
            url: issue.web_url || issue.permalink
          }
        ]
      }
    ];

    await this.sendToChannel('productionUsers', message, blocks);
  }

  /**
   * Get emoji for feedback category
   */
  private static getCategoryEmoji(category: string): string {
    switch (category) {
      case 'bug': return '🐛';
      case 'feature': return '✨';
      case 'improvement': return '🔧';
      case 'general': return '💬';
      default: return '💬';
    }
  }

  /**
   * Format category for display
   */
  private static formatCategory(category: string): string {
    switch (category) {
      case 'bug': return 'Bug Report';
      case 'feature': return 'Feature Request';
      case 'improvement': return 'Improvement';
      case 'general': return 'General Feedback';
      default: return category;
    }
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
