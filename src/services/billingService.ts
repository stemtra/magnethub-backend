import { User } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { stripeService } from './stripeService.js';
import { logger } from '../utils/logger.js';
import { config, PlanType } from '../config/index.js';

/**
 * Service for handling billing operations and usage tracking
 */
class BillingService {
  /**
   * Record lead magnet creation usage
   */
  async recordLeadMagnetUsage(userId: string): Promise<void> {
    try {
      const subscription = await this.getOrCreateSubscription(userId);

      // Check if we need to reset usage for new billing period
      await this.resetUsageIfNeeded(subscription);

      // Increment usage
      subscription.leadMagnetsCreatedThisPeriod += 1;
      await subscription.save();

      logger.info(`Recorded lead magnet usage for user: ${userId} (total: ${subscription.leadMagnetsCreatedThisPeriod})`);
    } catch (error) {
      logger.error('Error recording lead magnet usage:', error as Error);
      throw error;
    }
  }

  /**
   * Check if user can create a lead magnet
   */
  async canUserCreateLeadMagnet(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const subscription = await this.getOrCreateSubscription(userId);

      // Reset usage if needed
      await this.resetUsageIfNeeded(subscription);

      if (subscription.canCreateLeadMagnet()) {
        return { allowed: true };
      }

      const remaining = subscription.getLeadMagnetsRemaining();
      const limits = config.planLimits[subscription.plan as PlanType];

      if (subscription.plan === 'free') {
        return {
          allowed: false,
          reason: `You've reached your lifetime limit of ${limits.leadMagnetsTotal} free lead magnets. Upgrade to create more!`,
        };
      }

      return {
        allowed: false,
        reason: `You've reached your monthly limit of ${limits.leadMagnetsPerMonth} lead magnets. Your limit resets on ${subscription.currentPeriodEnd.toLocaleDateString()}.`,
      };
    } catch (error) {
      logger.error('Error checking lead magnet permissions:', error as Error);
      return { allowed: false, reason: 'Error checking permissions' };
    }
  }

  /**
   * Get user's subscription status
   */
  async getUserSubscriptionStatus(userId: string): Promise<{
    plan: PlanType;
    status: string;
    leadMagnetsUsed: number;
    leadMagnetsLimit: number | null;
    leadMagnetsRemaining: number | null;
    nextBillingDate: Date | null;
    cancelAtPeriodEnd: boolean;
    isPaid: boolean;
  }> {
    try {
      const subscription = await this.getOrCreateSubscription(userId);

      // Reset usage if needed
      await this.resetUsageIfNeeded(subscription);

      const limits = config.planLimits[subscription.plan as PlanType];
      const isPaid = subscription.isPaid();

      let leadMagnetsLimit: number | null = null;
      let leadMagnetsRemaining: number | null = null;

      if (subscription.plan === 'free') {
        leadMagnetsLimit = limits.leadMagnetsTotal;
        leadMagnetsRemaining = subscription.getLeadMagnetsRemaining();
      } else if (isPaid) {
        leadMagnetsLimit = limits.leadMagnetsPerMonth;
        leadMagnetsRemaining = subscription.getLeadMagnetsRemaining();
      }

      return {
        plan: subscription.plan as PlanType,
        status: subscription.status,
        leadMagnetsUsed: subscription.leadMagnetsCreatedThisPeriod,
        leadMagnetsLimit,
        leadMagnetsRemaining,
        nextBillingDate: isPaid ? subscription.currentPeriodEnd : null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        isPaid,
      };
    } catch (error) {
      logger.error('Error getting subscription status:', error as Error);
      throw error;
    }
  }

  /**
   * Get or create subscription for user
   */
  async getOrCreateSubscription(userId: string): Promise<any> {
    let subscription = await Subscription.findActiveByUserId(userId);

    if (!subscription) {
      // Create free subscription if none exists
      subscription = await Subscription.createFreeSubscription(userId);

      // Update user's current subscription pointer
      await User.findByIdAndUpdate(userId, {
        $set: { currentSubscriptionId: subscription._id },
      });

      logger.info(`Created free subscription for user: ${userId}`);
    }

    return subscription;
  }

  /**
   * Reset usage if we're in a new billing period (for paid plans only)
   */
  private async resetUsageIfNeeded(subscription: any): Promise<boolean> {
    // Free plans don't reset - lifetime limit
    if (subscription.plan === 'free') {
      return false;
    }

    const now = new Date();

    if (subscription.currentPeriodEnd <= now) {
      subscription.leadMagnetsCreatedThisPeriod = 0;

      // For paid plans, the period is updated by Stripe webhooks
      // This is just a fallback safety check
      logger.info(`Reset usage for subscription: ${subscription._id}`);
      await subscription.save();
      return true;
    }

    return false;
  }

  /**
   * Handle subscription creation/update from webhook
   */
  async handleSubscriptionWebhook(subscriptionData: {
    subscriptionId: string;
    customerId: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    priceId: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    try {
      // Find user by stripe customer ID
      const user = await User.findOne({ stripeCustomerId: subscriptionData.customerId });

      if (!user) {
        // Try to find user from metadata
        const userId = subscriptionData.metadata?.userId;
        if (userId) {
          const userById = await User.findById(userId);
          if (userById) {
            // Update user's stripe customer ID
            userById.stripeCustomerId = subscriptionData.customerId;
            await userById.save();
            await this.updateSubscriptionFromWebhook(userById._id.toString(), subscriptionData);
            return;
          }
        }

        logger.warn(`No user found for customer: ${subscriptionData.customerId}`);
        return;
      }

      await this.updateSubscriptionFromWebhook(user._id.toString(), subscriptionData);
    } catch (error) {
      logger.error('Error handling subscription webhook:', error as Error);
      throw error;
    }
  }

  /**
   * Update subscription from webhook data
   */
  private async updateSubscriptionFromWebhook(
    userId: string,
    subscriptionData: {
      subscriptionId: string;
      customerId: string;
      status: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      cancelAtPeriodEnd: boolean;
      priceId: string;
      metadata?: Record<string, string>;
    }
  ): Promise<void> {
    // Determine plan from price ID
    const plan = stripeService.getPlanFromPriceId(subscriptionData.priceId);

    // Find existing subscription or create new one
    let subscription = await Subscription.findOne({
      stripeSubscriptionId: subscriptionData.subscriptionId,
    });

    if (!subscription) {
      // Deactivate any existing active subscriptions
      const existingSubscription = await Subscription.findActiveByUserId(userId);
      if (existingSubscription) {
        existingSubscription.status = 'canceled';
        existingSubscription.canceledAt = new Date();
        existingSubscription.endedAt = new Date();
        await existingSubscription.save();
        logger.info(`Deactivated existing subscription for user: ${userId}`);
      }

      // Create new subscription
      subscription = await Subscription.createPaidSubscription(userId, plan, {
        customerId: subscriptionData.customerId,
        subscriptionId: subscriptionData.subscriptionId,
        priceId: subscriptionData.priceId,
        currentPeriodStart: subscriptionData.currentPeriodStart,
        currentPeriodEnd: subscriptionData.currentPeriodEnd,
      });

      logger.info(`Created new subscription for user: ${userId}, plan: ${plan}`);
    } else {
      // Update existing subscription
      subscription.status = subscriptionData.status as any;
      subscription.plan = plan;
      subscription.currentPeriodStart = subscriptionData.currentPeriodStart;
      subscription.currentPeriodEnd = subscriptionData.currentPeriodEnd;
      subscription.cancelAtPeriodEnd = subscriptionData.cancelAtPeriodEnd;
      subscription.stripePriceId = subscriptionData.priceId;

      if (subscriptionData.status === 'canceled') {
        subscription.canceledAt = new Date();
        subscription.endedAt = new Date();
      }

      await subscription.save();
      logger.info(`Updated subscription for user: ${userId}, status: ${subscriptionData.status}`);
    }

    // Update user's current subscription pointer
    if (subscriptionData.status === 'active') {
      await User.findByIdAndUpdate(userId, {
        $set: { currentSubscriptionId: subscription._id },
      });
    } else if (subscriptionData.status === 'canceled') {
      // Create free subscription when paid subscription is canceled
      const freeSubscription = await Subscription.createFreeSubscription(userId);
      await User.findByIdAndUpdate(userId, {
        $set: { currentSubscriptionId: freeSubscription._id },
      });
      logger.info(`Created free subscription for user after cancellation: ${userId}`);
    }
  }

  /**
   * Handle subscription deletion from webhook
   */
  async handleSubscriptionDeleted(subscriptionId: string): Promise<void> {
    try {
      const subscription = await Subscription.findOne({ stripeSubscriptionId: subscriptionId });

      if (!subscription) {
        logger.warn(`Subscription not found for deletion: ${subscriptionId}`);
        return;
      }

      // Mark as canceled
      subscription.status = 'canceled';
      subscription.canceledAt = new Date();
      subscription.endedAt = new Date();
      await subscription.save();

      // Create free subscription for the user
      const freeSubscription = await Subscription.createFreeSubscription(subscription.userId.toString());
      await User.findByIdAndUpdate(subscription.userId, {
        $set: { currentSubscriptionId: freeSubscription._id },
      });

      logger.info(`Subscription deleted and user moved to free: ${subscription.userId}`);
    } catch (error) {
      logger.error('Error handling subscription deletion:', error as Error);
      throw error;
    }
  }
}

export const billingService = new BillingService();

