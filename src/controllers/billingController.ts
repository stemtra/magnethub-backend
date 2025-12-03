import type { Request, Response, NextFunction } from 'express';
import { User } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { stripeService } from '../services/stripeService.js';
import { billingService } from '../services/billingService.js';
import { SlackService } from '../services/slackService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config, PlanType } from '../config/index.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

// ============================================
// Create Checkout Session
// ============================================

export async function createCheckoutSession(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { plan } = req.body as { plan: PlanType };

    if (!plan || !['starter', 'pro', 'agency'].includes(plan)) {
      throw AppError.badRequest('Invalid plan. Must be starter, pro, or agency.');
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      throw AppError.notFound('User not found');
    }

    // Check if user already has an active paid subscription
    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());
    if (activeSubscription && activeSubscription.isPaid()) {
      throw AppError.badRequest('You already have an active subscription. Please manage it from the billing settings.');
    }

    // Get or create Stripe customer
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        user.email,
        user.name,
        user._id.toString()
      );
      customerId = customer.id;

      // Save customer ID to user
      user.stripeCustomerId = customerId;
      await user.save();
      logger.info(`Saved Stripe customer ID ${customerId} to user ${user._id}`);
    }

    // Create checkout session
    const successUrl = `${config.clientUrl}/settings?tab=billing&success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.clientUrl}/settings?tab=billing&canceled=true`;

    const session = await stripeService.createCheckoutSession(
      customerId,
      user._id.toString(),
      plan,
      successUrl,
      cancelUrl
    );

    logger.info(`Created checkout session for user: ${user._id}, plan: ${plan}`);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Subscription Status
// ============================================

export async function getSubscriptionStatus(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const subscriptionStatus = await billingService.getUserSubscriptionStatus(req.user._id.toString());

    // Get payment method if user has paid subscription
    let paymentMethod = null;
    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (activeSubscription?.stripeCustomerId && activeSubscription.isPaid()) {
      const pm = await stripeService.getCustomerPaymentMethod(activeSubscription.stripeCustomerId);
      if (pm?.card) {
        paymentMethod = {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        };
      }
    }

    res.json({
      success: true,
      data: {
        ...subscriptionStatus,
        paymentMethod,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Create Portal Session
// ============================================

export async function createPortalSession(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (!activeSubscription?.stripeCustomerId) {
      throw AppError.notFound('No billing information found');
    }

    const returnUrl = `${config.clientUrl}/settings?tab=billing`;
    const session = await stripeService.createPortalSession(activeSubscription.stripeCustomerId, returnUrl);

    res.json({
      success: true,
      data: {
        url: session.url,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Invoices
// ============================================

export async function getInvoices(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (!activeSubscription?.stripeCustomerId) {
      res.json({
        success: true,
        data: [],
      });
      return;
    }

    const invoices = await stripeService.getCustomerInvoices(activeSubscription.stripeCustomerId, 20);

    const formattedInvoices = invoices.map((invoice) => ({
      id: invoice.id,
      date: new Date(invoice.created * 1000).toISOString(),
      description: invoice.description || 'MagnetHub Subscription',
      amount: `$${(invoice.amount_paid / 100).toFixed(2)}`,
      status: invoice.status,
      pdfUrl: invoice.invoice_pdf,
    }));

    res.json({
      success: true,
      data: formattedInvoices,
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Cancel Subscription
// ============================================

export async function cancelSubscription(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (!activeSubscription?.stripeSubscriptionId) {
      throw AppError.notFound('No active subscription found');
    }

    if (activeSubscription.cancelAtPeriodEnd) {
      throw AppError.badRequest('Subscription is already scheduled for cancellation');
    }

    // Cancel in Stripe
    await stripeService.cancelSubscription(activeSubscription.stripeSubscriptionId);

    // Update local subscription
    activeSubscription.cancelAtPeriodEnd = true;
    activeSubscription.metadata = {
      ...activeSubscription.metadata,
      cancelReason: req.body.reason || 'user_requested',
    };
    await activeSubscription.save();

    logger.info(`Subscription canceled at period end for user: ${req.user._id}`);

    res.json({
      success: true,
      data: {
        message: 'Subscription will be canceled at the end of your billing period',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Reactivate Subscription
// ============================================

export async function reactivateSubscription(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (!activeSubscription?.stripeSubscriptionId) {
      throw AppError.notFound('No active subscription found');
    }

    if (!activeSubscription.cancelAtPeriodEnd) {
      throw AppError.badRequest('Subscription is not scheduled for cancellation');
    }

    // Reactivate in Stripe
    await stripeService.reactivateSubscription(activeSubscription.stripeSubscriptionId);

    // Update local subscription
    activeSubscription.cancelAtPeriodEnd = false;
    if (activeSubscription.metadata) {
      delete activeSubscription.metadata.cancelReason;
    }
    await activeSubscription.save();

    logger.info(`Subscription reactivated for user: ${req.user._id}`);

    res.json({
      success: true,
      data: {
        message: 'Subscription has been reactivated successfully',
        cancelAtPeriodEnd: false,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Change Plan (Upgrade/Downgrade)
// ============================================

export async function changePlan(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { plan } = req.body as { plan: PlanType };

    if (!plan || !['starter', 'pro', 'agency'].includes(plan)) {
      throw AppError.badRequest('Invalid plan. Must be starter, pro, or agency.');
    }

    const activeSubscription = await Subscription.findActiveByUserId(req.user._id.toString());

    if (!activeSubscription?.stripeSubscriptionId) {
      throw AppError.notFound('No active subscription found. Please subscribe first.');
    }

    if (activeSubscription.plan === plan) {
      throw AppError.badRequest(`You are already on the ${plan} plan`);
    }

    const oldPlan = activeSubscription.plan;

    // Change plan in Stripe (this will prorate the charges)
    await stripeService.changePlan(activeSubscription.stripeSubscriptionId, plan);

    // Update local subscription
    activeSubscription.plan = plan;
    activeSubscription.stripePriceId = stripeService.getPriceIdForPlan(plan);
    await activeSubscription.save();

    logger.info(`Plan changed for user ${req.user._id}: ${oldPlan} -> ${plan}`);

    // Send Slack notification for plan change
    try {
      const user = await User.findById(req.user._id);
      if (user) {
        await SlackService.sendPlanChangeNotification(
          user.email,
          user.name,
          oldPlan,
          plan
        );
      }
    } catch (slackError) {
      logger.error('Failed to send Slack notification for plan change:', slackError as Error);
    }

    res.json({
      success: true,
      data: {
        message: `Successfully upgraded to ${plan} plan`,
        plan,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Webhook Handler
// ============================================

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const payload = req.body;

    if (!signature) {
      logger.error('Webhook error: Missing stripe-signature header');
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    // Verify payload is raw Buffer
    if (!Buffer.isBuffer(payload)) {
      logger.error('Webhook error: Payload is not a Buffer');
      res.status(400).json({ error: 'Invalid payload format' });
      return;
    }

    // Construct and verify the event
    const event = stripeService.constructWebhookEvent(payload, signature);

    logger.info(`Received Stripe webhook: ${event.type}`, { eventId: event.id });

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as any);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as any);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as any);
        break;

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as any);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as any);
        break;

      default:
        logger.info(`Unhandled webhook event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    const err = error as Error;
    logger.error('Error handling webhook:', err);
    res.status(400).json({ error: 'Webhook error' });
  }
}

// ============================================
// Webhook Event Handlers
// ============================================

async function handleCheckoutCompleted(session: any): Promise<void> {
  try {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan as PlanType;

    if (!userId) {
      logger.warn('No userId in checkout session metadata');
      return;
    }

    logger.info(`Checkout completed for user: ${userId}, plan: ${plan}`);

    if (session.subscription) {
      const subscriptionData = await stripeService.getSubscriptionData(session.subscription);

      if (!subscriptionData) {
        logger.error(`Failed to retrieve subscription data: ${session.subscription}`);
        return;
      }

      // Deactivate any existing subscriptions
      const existingSubscription = await Subscription.findActiveByUserId(userId);
      if (existingSubscription) {
        existingSubscription.status = 'canceled';
        existingSubscription.canceledAt = new Date();
        existingSubscription.endedAt = new Date();
        await existingSubscription.save();
      }

      // Create new subscription
      const subscription = await Subscription.createPaidSubscription(userId, plan, {
        customerId: subscriptionData.customerId,
        subscriptionId: subscriptionData.subscriptionId,
        priceId: subscriptionData.priceId,
        currentPeriodStart: subscriptionData.currentPeriodStart,
        currentPeriodEnd: subscriptionData.currentPeriodEnd,
      });

      // Update user's subscription pointer
      await User.findByIdAndUpdate(userId, {
        $set: { currentSubscriptionId: subscription._id },
      });

      logger.info(`Created subscription for user: ${userId}, plan: ${plan}`);

      // Send Slack notification for new subscription
      try {
        const user = await User.findById(userId);
        if (user) {
          // Get amount from session or use plan prices as fallback (in cents)
          const planPrices: Record<string, number> = {
            starter: 2900,  // $29
            pro: 7900,      // $79
            agency: 19900,  // $199
          };
          const amount = session.amount_total || planPrices[plan] || 0;
          
          logger.info(`Sending Slack notification for new subscription: user=${user.email}, plan=${plan}, amount=${amount}`);
          
          await SlackService.sendNewSubscriptionNotification(
            user.email,
            user.name,
            plan,
            'monthly', // Default to monthly, could be enhanced to detect from session
            amount
          );
        } else {
          logger.warn(`User not found for Slack notification: ${userId}`);
        }
      } catch (slackError) {
        logger.error('Failed to send Slack notification for new subscription:', slackError as Error);
      }
    }
  } catch (error) {
    logger.error('Error handling checkout completed:', error as Error);
  }
}

async function handleSubscriptionUpdated(subscription: any): Promise<void> {
  try {
    const priceId = subscription.items.data[0]?.price?.id;
    const plan = stripeService.getPlanFromPriceId(priceId);

    // Get existing subscription to detect changes
    const existingSubscription = await Subscription.findOne({ stripeSubscriptionId: subscription.id });
    const oldPlan = existingSubscription ? existingSubscription.plan : null;

    await billingService.handleSubscriptionWebhook({
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.items.data[0]?.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.items.data[0]?.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      priceId,
      metadata: subscription.metadata,
    });

    logger.info(`Subscription updated: ${subscription.id}, status: ${subscription.status}`);

    // Send Slack notifications for meaningful changes
    try {
      const user = await User.findOne({ stripeCustomerId: subscription.customer });
      if (user) {
        // Plan change notification
        if (oldPlan && oldPlan !== plan) {
          await SlackService.sendPlanChangeNotification(
            user.email,
            user.name,
            oldPlan,
            plan
          );
        }

        // Reactivation notification (if cancel_at_period_end changed from true to false)
        if (existingSubscription?.cancelAtPeriodEnd && !subscription.cancel_at_period_end) {
          await SlackService.sendSubscriptionReactivatedNotification(
            user.email,
            user.name,
            plan
          );
        }
      }
    } catch (slackError) {
      logger.error('Failed to send Slack notification for subscription update:', slackError as Error);
    }
  } catch (error) {
    logger.error('Error handling subscription updated:', error as Error);
  }
}

async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  try {
    // Get subscription info before deletion for notification
    const existingSubscription = await Subscription.findOne({ stripeSubscriptionId: subscription.id });
    const user = existingSubscription ? await User.findById(existingSubscription.userId) : null;

    await billingService.handleSubscriptionDeleted(subscription.id);
    logger.info(`Subscription deleted: ${subscription.id}`);

    // Send Slack notification for cancellation
    if (user && existingSubscription) {
      try {
        await SlackService.sendSubscriptionCancelledNotification(
          user.email,
          user.name,
          existingSubscription.plan,
          existingSubscription.metadata?.cancelReason || 'stripe_webhook'
        );
      } catch (slackError) {
        logger.error('Failed to send Slack notification for subscription cancellation:', slackError as Error);
      }
    }
  } catch (error) {
    logger.error('Error handling subscription deleted:', error as Error);
  }
}

async function handleInvoicePaymentSucceeded(invoice: any): Promise<void> {
  try {
    logger.info(`Invoice payment succeeded: ${invoice.id}, amount: ${invoice.amount_paid / 100}`);

    // Send Slack notification for recurring payment (only if it's not the first payment)
    if (invoice.billing_reason === 'subscription_cycle') {
      try {
        const user = await User.findOne({ stripeCustomerId: invoice.customer });
        if (user) {
          const subscription = await Subscription.findActiveByUserId(user._id.toString());
          const billingInterval = subscription?.plan === 'starter' ? 'monthly' : 'monthly'; // Could be enhanced

          await SlackService.sendRecurringPaymentNotification(
            user.email,
            user.name,
            invoice.amount_paid,
            billingInterval
          );
        }
      } catch (slackError) {
        logger.error('Failed to send Slack notification for recurring payment:', slackError as Error);
      }
    }
  } catch (error) {
    logger.error('Error handling invoice payment succeeded:', error as Error);
  }
}

async function handleInvoicePaymentFailed(invoice: any): Promise<void> {
  try {
    logger.warn(`Invoice payment failed: ${invoice.id}, amount: ${invoice.amount_due / 100}`);

    // Send Slack notification for payment failure
    try {
      const user = await User.findOne({ stripeCustomerId: invoice.customer });
      if (user) {
        await SlackService.sendPaymentFailedNotification(
          user.email,
          user.name,
          invoice.amount_due,
          invoice.last_payment_error?.message
        );
      }
    } catch (slackError) {
      logger.error('Failed to send Slack notification for payment failure:', slackError as Error);
    }
  } catch (error) {
    logger.error('Error handling invoice payment failed:', error as Error);
  }
}

