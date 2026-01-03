import mongoose, { Schema } from 'mongoose';
import type { IBrand } from '../types/index.js';

const brandSettingsSchema = new Schema(
  {
    primaryColor: { type: String, default: '#1F1F1F' }, // Neutral dark gray instead of MagnetHub black
    accentColor: { type: String, default: '#3B82F6' }, // Blue instead of MagnetHub green
    backgroundColor: { type: String, default: '#FFFFFF' }, // White instead of MagnetHub black
    textColor: { type: String, default: '#1F1F1F' }, // Dark gray for light backgrounds
    fontFamily: { type: String, default: 'Inter' }, // Inter instead of MagnetHub's Plus Jakarta Sans
    theme: { type: String, enum: ['light', 'dark'], default: 'light' }, // Light theme as default
    logoUrl: { type: String },
    landingPageTemplate: { 
      type: String, 
      enum: ['minimal', 'bold', 'split', 'classic'],
      default: 'minimal',
    },
  },
  { _id: false }
);

const brandSchema = new Schema<IBrand>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      trim: true,
      maxlength: [100, 'Brand name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    sourceType: {
      type: String,
      enum: {
        values: ['website', 'instagram', 'youtube'],
        message: 'Source type must be one of: website, instagram, youtube',
      },
      required: [true, 'Source type is required'],
    },
    sourceUrl: {
      type: String,
      required: [true, 'Source URL is required'],
      trim: true,
    },
    settings: {
      type: brandSettingsSchema,
      default: () => ({}),
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    brandVoice: {
      type: String,
      trim: true,
      maxlength: [1000, 'Brand voice cannot exceed 1000 characters'],
    },
    targetAudience: {
      type: String,
      trim: true,
      maxlength: [1000, 'Target audience cannot exceed 1000 characters'],
    },
    keyMessages: {
      type: [String],
      default: [],
      validate: {
        validator: function(v: string[]) {
          return v.length <= 10;
        },
        message: 'Cannot have more than 10 key messages',
      },
    },
    scrapedContent: {
      type: String,
      trim: true,
    },
    scrapedAt: {
      type: Date,
    },
    isScraped: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// Indexes
// ============================================

// Compound index for unique source per user (can't have same website/IG twice)
brandSchema.index({ userId: 1, sourceUrl: 1 }, { unique: true });
brandSchema.index({ userId: 1, isDefault: 1 });
brandSchema.index({ userId: 1, createdAt: -1 });

// ============================================
// Pre-save hook to ensure only one default brand per user
// ============================================

brandSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Remove default from other brands
    await mongoose.model('Brand').updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

// ============================================
// Transform for JSON
// ============================================

brandSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

brandSchema.set('toObject', { virtuals: true });

export const Brand = mongoose.model<IBrand>('Brand', brandSchema);

