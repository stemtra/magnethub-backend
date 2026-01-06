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
      // Not required for user-uploaded media
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
      // Not required for user-uploaded media
      enum: {
        values: ['get_leads', 'sell_call', 'grow_list'],
        message: 'Goal must be one of: get_leads, sell_call, grow_list',
      },
    },
    type: {
      type: String,
      required: [true, 'Type is required'],
      enum: {
        values: ['guide', 'checklist', 'mistakes', 'blueprint', 'swipefile', 'cheatsheet', 'casestudy', 'infographic', 'uploaded_pdf', 'uploaded_image', 'uploaded_audio'],
        message: 'Type must be one of: guide, checklist, mistakes, blueprint, swipefile, cheatsheet, casestudy, infographic, uploaded_pdf, uploaded_image, uploaded_audio',
      },
    },
    tone: {
      type: String,
      // Not required for user-uploaded media
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
    // Infographic-specific fields
    infographicUrl: {
      type: String,
      trim: true,
    },
    infographicStyle: {
      type: String,
      enum: {
        values: ['minimal', 'modern', 'bold', 'professional'],
        message: 'Infographic style must be one of: minimal, modern, bold, professional',
      },
    },
    infographicOrientation: {
      type: String,
      enum: {
        values: ['square', 'portrait', 'landscape'],
        message: 'Infographic orientation must be one of: square, portrait, landscape',
      },
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
    generationStatus: {
      type: String,
      enum: {
        values: ['pdf_ready', 'complete', 'needs_attention'],
        message: 'Generation status must be one of: pdf_ready, complete, needs_attention',
      },
      default: 'pdf_ready',
    },
    landingStatus: {
      type: String,
      enum: {
        values: ['pending', 'ready', 'failed'],
        message: 'Landing status must be one of: pending, ready, failed',
      },
      default: 'pending',
    },
    emailsStatus: {
      type: String,
      enum: {
        values: ['pending', 'ready', 'failed'],
        message: 'Emails status must be one of: pending, ready, failed',
      },
      default: 'pending',
    },
    generationError: {
      type: String,
      trim: true,
      maxlength: [2000, 'Generation error cannot exceed 2000 characters'],
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
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    // User-uploaded media fields
    isUserUploaded: {
      type: Boolean,
      default: false,
    },
    uploadedFileUrl: {
      type: String,
      trim: true,
    },
    uploadedFileName: {
      type: String,
      trim: true,
    },
    uploadedFileType: {
      type: String,
      enum: {
        values: ['pdf', 'image', 'audio'],
        message: 'Uploaded file type must be one of: pdf, image, audio',
      },
    },
    uploadedFileMimeType: {
      type: String,
      trim: true,
    },
    uploadedFileSize: {
      type: Number,
      min: [0, 'File size cannot be negative'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
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
leadMagnetSchema.index({ isPublic: 1, createdAt: -1 });

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

