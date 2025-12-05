import mongoose, { Schema } from 'mongoose';
import type { ILeadMagnet } from '../types/index.js';

const leadMagnetSchema = new Schema<ILeadMagnet>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
      index: true,
    },
    sourceType: {
      type: String,
      enum: {
        values: ['website', 'instagram', 'youtube'],
        message: 'Source type must be one of: website, instagram, youtube',
      },
      default: 'website',
    },
    sourceUrl: {
      type: String,
      required: [true, 'Source URL is required'],
      trim: true,
    },
    // @deprecated - kept for backward compatibility, use sourceUrl instead
    websiteUrl: {
      type: String,
      trim: true,
    },
    audience: {
      type: String,
      trim: true,
      maxlength: [500, 'Audience description cannot exceed 500 characters'],
    },
    goal: {
      type: String,
      required: [true, 'Goal is required'],
      enum: {
        values: ['get_leads', 'sell_call', 'grow_list'],
        message: 'Goal must be one of: get_leads, sell_call, grow_list',
      },
    },
    type: {
      type: String,
      required: [true, 'Type is required'],
      enum: {
        values: ['guide', 'checklist', 'mistakes', 'blueprint', 'swipefile', 'cheatsheet', 'casestudy'],
        message: 'Type must be one of: guide, checklist, mistakes, blueprint, swipefile, cheatsheet, casestudy',
      },
    },
    tone: {
      type: String,
      required: [true, 'Tone is required'],
      enum: {
        values: ['professional', 'friendly', 'expert', 'persuasive'],
        message: 'Tone must be one of: professional, friendly, expert, persuasive',
      },
    },
    title: {
      type: String,
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    pdfUrl: {
      type: String,
      trim: true,
    },
    landingPageHtml: {
      type: String,
    },
    landingPageCopyJson: {
      type: Schema.Types.Mixed, // Store landing page copy for re-rendering
    },
    emailsJson: {
      type: Schema.Types.Mixed, // Store as JSON object
    },
    outlineJson: {
      type: Schema.Types.Mixed,
    },
    metaJson: {
      type: Schema.Types.Mixed,
    },
    contentJson: {
      type: Schema.Types.Mixed,
    },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// Indexes
// ============================================

// Compound index for unique slug per user
leadMagnetSchema.index({ userId: 1, slug: 1 }, { unique: true });
leadMagnetSchema.index({ userId: 1, createdAt: -1 });

// ============================================
// Virtual for lead count (will be populated)
// ============================================

leadMagnetSchema.virtual('leadCount', {
  ref: 'Lead',
  localField: '_id',
  foreignField: 'leadMagnetId',
  count: true,
});

// ============================================
// Transform for JSON
// ============================================

leadMagnetSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

leadMagnetSchema.set('toObject', { virtuals: true });

export const LeadMagnet = mongoose.model<ILeadMagnet>('LeadMagnet', leadMagnetSchema);

