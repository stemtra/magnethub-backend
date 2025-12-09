import Stripe from 'stripe';
import { config, PlanType } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Initialize Stripe
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: '2025-11-17.clover' })
  : null;

export interface SubscriptionData {
  customerId: string;
  subscriptionId: string;
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceId: string;
}

class StripeService {
  /**
   * Check if Stripe is properly configured
   */
  private ensureStripeConfigured(): void {
    if (!stripe) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
    }
  }

  /**
   * Get Stripe instance (for direct access when needed)
   */
  getStripe(): Stripe {
    this.ensureStripeConfigured();
    return stripe!;
  }

  /**
   * Create Stripe customer
   */
  async createCustomer(email: string, name: string, userId: string): Promise<Stripe.Customer> {
    this.ensureStripeConfigured();

    try {
      const customer = await stripe!.customers.create({
        email,
        name,
        metadata: {
          userId,
        },
      });

      logger.info(`Created Stripe customer: ${customer.id} for user: ${userId}`);
      return customer;
    } catch (error) {
      logger.error('Error creating Stripe customer:', error as Error);
      throw error;
    }
  }

  /**
   * Get price ID for a plan
   */
  getPriceIdForPlan(plan: PlanType): string {
    const priceMap: Record<string, string> = {
      starter: config.stripe.prices.starter,
      pro: config.stripe.prices.pro,
      agency: config.stripe.prices.agency,
    };

    const priceId = priceMap[plan];
    if (!priceId) {
      throw new Error(`No price ID configured for plan: ${plan}`);
    }

    return priceId;
  }

  /**
   * Get plan from price ID
   */
  getPlanFromPriceId(priceId: string): PlanType {
    if (priceId === config.stripe.prices.starter) return 'starter';
    if (priceId === config.stripe.prices.pro) return 'pro';
    if (priceId === config.stripe.prices.agency) return 'agency';
    return 'free';
  }

  /**
   * Create checkout session for subscription
   */
  async createCheckoutSession(
    customerId: string,
    userId: string,
    plan: PlanType,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    this.ensureStripeConfigured();

    try {
      const priceId = this.getPriceIdForPlan(plan);

      const session = await stripe!.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId,
          plan,
        },
        subscription_data: {
          metadata: {
            userId,
            plan,
          },
        },
      });

      logger.info(`Created checkout session: ${session.id} for user: ${userId}, plan: ${plan}`);
      return session;
    } catch (error) {
      logger.error('Error creating checkout session:', error as Error);
      throw error;
    }
  }

  /**
   * Get subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    this.ensureStripeConfigured();

    try {
      const subscription = await stripe!.subscriptions.retrieve(subscriptionId);
      return subscription;
    } catch (error) {
      logger.error('Error retrieving subscription:', error as Error);
      throw error;
    }
  }

  /**
   * Get customer by ID
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    this.ensureStripeConfigured();

    try {
      const customer = (await stripe!.customers.retrieve(customerId)) as Stripe.Customer;
      return customer;
    } catch (error) {
      logger.error('Error retrieving customer:', error as Error);
      throw error;
    }
  }

  /**
   * Get customer's default payment method
   */
  async getCustomerPaymentMethod(customerId: string): Promise<Stripe.PaymentMethod | null> {
    this.ensureStripeConfigured();

    try {
      const customer = (await stripe!.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      })) as Stripe.Customer;

      if (customer.invoice_settings?.default_payment_method) {
        const paymentMethod = customer.invoice_settings.default_payment_method;
        if (typeof paymentMethod === 'string') {
          return await stripe!.paymentMethods.retrieve(paymentMethod);
        }
        return paymentMethod as Stripe.PaymentMethod;
      }

      // Fallback: get the most recent payment method
      const paymentMethods = await stripe!.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1,
      });

      return paymentMethods.data[0] || null;
    } catch (error) {
      logger.error('Error retrieving payment method:', error as Error);
      return null;
    }
  }

  /**
   * Get subscription data formatted for our app
   */
  async getSubscriptionData(subscriptionId: string): Promise<SubscriptionData | null> {
    try {
      const subscription = await this.getSubscription(subscriptionId);

      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return null;
      }

      return {
        customerId: subscription.customer as string,
        subscriptionId: subscription.id,
        status: subscription.status as SubscriptionData['status'],
        currentPeriodStart: new Date((subscription.items.data[0]?.current_period_start as number) * 1000),
        currentPeriodEnd: new Date((subscription.items.data[0]?.current_period_end as number) * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: subscription.items.data[0]?.price.id || '',
      };
    } catch (error) {
      logger.error('Error getting subscription data:', error as Error);
      return null;
    }
  }

  /**
   * Cancel subscription at period end
   */
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    this.ensureStripeConfigured();

    try {
      const subscription = await stripe!.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      logger.info(`Canceled subscription at period end: ${subscriptionId}`);
      return subscription;
    } catch (error) {
      logger.error('Error canceling subscription:', error as Error);
      throw error;
    }
  }

  /**
   * Reactivate subscription (undo cancel at period end)
   */
  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    this.ensureStripeConfigured();

    try {
      const subscription = await stripe!.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      logger.info(`Reactivated subscription: ${subscriptionId}`);
      return subscription;
    } catch (error) {
      logger.error('Error reactivating subscription:', error as Error);
      throw error;
    }
  }

  /**
   * Change subscription plan
   */
  async changePlan(subscriptionId: string, newPlan: PlanType): Promise<Stripe.Subscription> {
    this.ensureStripeConfigured();

    try {
      const subscription = await this.getSubscription(subscriptionId);
      const newPriceId = this.getPriceIdForPlan(newPlan);

      // Get the current subscription item
      const currentItem = subscription.items.data[0];
      if (!currentItem) {
        throw new Error('No subscription item found');
      }

      const updatedSubscription = await stripe!.subscriptions.update(subscriptionId, {
        items: [
          {
            id: currentItem.id,
            price: newPriceId,
          },
        ],
        // Bill the prorated difference immediately
        proration_behavior: 'always_invoice',
        metadata: {
          ...subscription.metadata,
          plan: newPlan,
        },
      });

      logger.info(`Changed subscription ${subscriptionId} to plan: ${newPlan}`);
      return updatedSubscription;
    } catch (error) {
      logger.error('Error changing plan:', error as Error);
      throw error;
    }
  }

  /**
   * Get customer portal session for subscription management
   */
  async createPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
    this.ensureStripeConfigured();

    try {
      const session = await stripe!.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      logger.info(`Created portal session for customer: ${customerId}`);
      return session;
    } catch (error) {
      logger.error('Error creating portal session:', error as Error);
      throw error;
    }
  }

  /**
   * Get invoices for a customer
   */
  async getCustomerInvoices(customerId: string, limit: number = 10): Promise<Stripe.Invoice[]> {
    this.ensureStripeConfigured();

    try {
      const invoices = await stripe!.invoices.list({
        customer: customerId,
        limit,
        status: 'paid',
      });

      return invoices.data;
    } catch (error) {
      logger.error('Error retrieving invoices:', error as Error);
      throw error;
    }
  }

  /**
   * Construct webhook event from raw body and signature
   */
  constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
    this.ensureStripeConfigured();

    try {
      const event = stripe!.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
      return event;
    } catch (error) {
      logger.error('Error constructing webhook event:', error as Error);
      throw error;
    }
  }
}

export const stripeService = new StripeService();

