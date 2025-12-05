import mongoose, { Schema, Document, Types } from 'mongoose';

// ============================================
// PageView Interface
// ============================================

export interface IPageView extends Document {
  _id: Types.ObjectId;
  leadMagnetId: Types.ObjectId;
  // Source tracking
  referrer?: string;
  source: string;
  medium?: string;
  campaign?: string;
  // Additional metadata
  userAgent?: string;
  ip?: string;
  country?: string;
  // Timestamps
  createdAt: Date;
}

// ============================================
// PageView Schema
// ============================================

const pageViewSchema = new Schema<IPageView>(
  {
    leadMagnetId: {
      type: Schema.Types.ObjectId,
      ref: 'LeadMagnet',
      required: [true, 'Lead Magnet ID is required'],
      index: true,
    },
    referrer: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      required: true,
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
    userAgent: {
      type: String,
      trim: true,
    },
    ip: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// ============================================
// Indexes
// ============================================

pageViewSchema.index({ leadMagnetId: 1, createdAt: -1 });
pageViewSchema.index({ source: 1 });
pageViewSchema.index({ createdAt: -1 });

// ============================================
// Transform for JSON
// ============================================

pageViewSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const PageView = mongoose.model<IPageView>('PageView', pageViewSchema);

