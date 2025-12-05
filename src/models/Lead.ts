import mongoose, { Schema } from 'mongoose';
import type { ILead } from '../types/index.js';

const leadSchema = new Schema<ILead>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    leadMagnetId: {
      type: Schema.Types.ObjectId,
      ref: 'LeadMagnet',
      required: [true, 'Lead Magnet ID is required'],
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: {
        values: ['pending', 'sent', 'failed'],
        message: 'Delivery status must be one of: pending, sent, failed',
      },
      default: 'pending',
    },
    // Source tracking
    referrer: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      default: 'direct',
      trim: true,
      lowercase: true,
    },
    medium: {
      type: String,
      trim: true,
      lowercase: true,
    },
    campaign: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// Indexes
// ============================================

// Compound index to prevent duplicate emails per lead magnet
leadSchema.index({ email: 1, leadMagnetId: 1 }, { unique: true });
leadSchema.index({ leadMagnetId: 1, createdAt: -1 });
leadSchema.index({ deliveryStatus: 1 });
leadSchema.index({ source: 1 });

// ============================================
// Transform for JSON
// ============================================

leadSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Lead = mongoose.model<ILead>('Lead', leadSchema);

