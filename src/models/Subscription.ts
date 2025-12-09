import mongoose, { Schema, Model } from 'mongoose';
import type { ISubscription, PlanType } from '../types/index.js';
import { config } from '../config/index.js';

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'agency'],
      required: true,
      default: 'free',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'incomplete', 'trialing'],
      required: true,
      default: 'active',
      index: true,
    },

    // Stripe integration
    stripeCustomerId: {
      type: String,
      sparse: true,
    },
    stripeSubscriptionId: {
      type: String,
      sparse: true,
      unique: true,
    },
    stripePriceId: {
      type: String,
      sparse: true,
    },

    // Billing periods
    currentPeriodStart: {
      type: Date,
      required: true,
      index: true,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },

    // Usage tracking
    leadMagnetsCreatedThisPeriod: {
      type: Number,
      default: 0,
      min: [0, 'Lead magnets created cannot be negative'],
    },

    // Lifecycle dates
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    canceledAt: Date,
    endedAt: Date,

    // Metadata
    metadata: {
      source: String,
      cancelReason: String,
      defaultPaymentMethodId: String,
      cardBrand: String,
      cardLast4: String,
      cardExpMonth: Number,
      cardExpYear: Number,
    },
  },
  {
    timestamps: true,
    collection: 'subscriptions',
  }
);

// Indexes
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
subscriptionSchema.index({ createdAt: -1 });

// ============================================
// Instance Methods
// ============================================

subscriptionSchema.methods.isActive = function (): boolean {
  return this.status === 'active' && this.currentPeriodEnd > new Date();
};

subscriptionSchema.methods.isPaid = function (): boolean {
  return ['starter', 'pro', 'agency'].includes(this.plan) && this.isActive();
};

subscriptionSchema.methods.canCreateLeadMagnet = function (): boolean {
  if (!this.isActive()) return false;

  // Free plan has lifetime limit
  if (this.plan === 'free') {
    const limits = config.planLimits.free;
    return this.leadMagnetsCreatedThisPeriod < limits.leadMagnetsTotal;
  }
  
  // Paid plans have monthly limit
  const limits = config.planLimits[this.plan as 'starter' | 'pro' | 'agency'];
  return this.leadMagnetsCreatedThisPeriod < limits.leadMagnetsPerMonth;
};

subscriptionSchema.methods.getLeadMagnetsRemaining = function (): number {
  if (this.plan === 'free') {
    const limits = config.planLimits.free;
    return Math.max(0, limits.leadMagnetsTotal - this.leadMagnetsCreatedThisPeriod);
  }
  
  const limits = config.planLimits[this.plan as 'starter' | 'pro' | 'agency'];
  return Math.max(0, limits.leadMagnetsPerMonth - this.leadMagnetsCreatedThisPeriod);
};

// ============================================
// Static Methods Interface
// ============================================

interface ISubscriptionModel extends Model<ISubscription> {
  findActiveByUserId(userId: string): Promise<ISubscription | null>;
  createFreeSubscription(userId: string): Promise<ISubscription>;
  createPaidSubscription(
    userId: string,
    plan: PlanType,
    stripeData: {
      customerId: string;
      subscriptionId: string;
      priceId: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    }
  ): Promise<ISubscription>;
}

// ============================================
// Static Methods
// ============================================

subscriptionSchema.statics.findActiveByUserId = function (userId: string) {
  return this.findOne({
    userId,
    status: 'active',
    currentPeriodEnd: { $gt: new Date() },
  });
};

subscriptionSchema.statics.createFreeSubscription = function (userId: string) {
  const now = new Date();
  // Free plan doesn't expire - set far future date
  const farFuture = new Date(now.getFullYear() + 100, 0, 1);

  return this.create({
    userId,
    plan: 'free',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: farFuture,
    startedAt: now,
    cancelAtPeriodEnd: false,
    leadMagnetsCreatedThisPeriod: 0,
  });
};

subscriptionSchema.statics.createPaidSubscription = function (
  userId: string,
  plan: PlanType,
  stripeData: {
    customerId: string;
    subscriptionId: string;
    priceId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }
) {
  return this.create({
    userId,
    plan,
    status: 'active',
    stripeCustomerId: stripeData.customerId,
    stripeSubscriptionId: stripeData.subscriptionId,
    stripePriceId: stripeData.priceId,
    currentPeriodStart: stripeData.currentPeriodStart,
    currentPeriodEnd: stripeData.currentPeriodEnd,
    startedAt: new Date(),
    cancelAtPeriodEnd: false,
    leadMagnetsCreatedThisPeriod: 0,
    metadata: {
      source: 'stripe_checkout',
    },
  });
};

// ============================================
// Transform for JSON
// ============================================

subscriptionSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Subscription = mongoose.model<ISubscription, ISubscriptionModel>(
  'Subscription',
  subscriptionSchema
);

