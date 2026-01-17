import mongoose, { Schema } from 'mongoose';
import type { IQuiz } from '../types/index.js';

// ============================================
// Sub-schemas
// ============================================

const quizAnswerSchema = new Schema(
  {
    answerText: {
      type: String,
      required: [true, 'Answer text is required'],
      trim: true,
      maxlength: [500, 'Answer text cannot exceed 500 characters'],
    },
    resultMapping: {
      type: Schema.Types.ObjectId,
      // References a result within the same quiz's results array
    },
  },
  { _id: true }
);

const quizQuestionSchema = new Schema(
  {
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
      maxlength: [1000, 'Question text cannot exceed 1000 characters'],
    },
    order: {
      type: Number,
      required: [true, 'Question order is required'],
      min: 0,
    },
    answers: {
      type: [quizAnswerSchema],
      validate: {
        validator: function (v: any[]) {
          return v && v.length >= 2 && v.length <= 6;
        },
        message: 'Questions must have between 2 and 6 answers',
      },
    },
  },
  { _id: true }
);

const quizResultSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Result name is required'],
      trim: true,
      maxlength: [100, 'Result name cannot exceed 100 characters'],
    },
    emoji: {
      type: String,
      trim: true,
      maxlength: [10, 'Emoji cannot exceed 10 characters'],
    },
    summary: {
      type: String,
      required: [true, 'Result summary is required'],
      trim: true,
      maxlength: [2000, 'Summary cannot exceed 2000 characters'],
    },
    traits: {
      type: [String],
      default: [],
    },
    recommendation: {
      type: String,
      trim: true,
      maxlength: [2000, 'Recommendation cannot exceed 2000 characters'],
    },
    ctaText: {
      type: String,
      trim: true,
      maxlength: [100, 'CTA text cannot exceed 100 characters'],
    },
    ctaUrl: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
  },
  { _id: true }
);

const emailFieldsSchema = new Schema(
  {
    requireEmail: {
      type: Boolean,
      default: true,
    },
    requireName: {
      type: Boolean,
      default: false,
    },
    requirePhone: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const quizStatsSchema = new Schema(
  {
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
    starts: {
      type: Number,
      default: 0,
      min: 0,
    },
    completions: {
      type: Number,
      default: 0,
      min: 0,
    },
    emailsCaptured: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ============================================
// Main Quiz Schema
// ============================================

const quizSchema = new Schema<IQuiz>(
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
    leadMagnetId: {
      type: Schema.Types.ObjectId,
      ref: 'LeadMagnet',
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Quiz title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: [500, 'Subtitle cannot exceed 500 characters'],
    },
    coverImageUrl: {
      type: String,
      trim: true,
    },
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
    },

    // Email capture settings
    emailCapturePoint: {
      type: String,
      enum: {
        values: ['before_results', 'after_results'],
        message: 'Email capture point must be either before_results or after_results',
      },
      default: 'before_results',
    },
    emailFields: {
      type: emailFieldsSchema,
      default: () => ({
        requireEmail: true,
        requireName: false,
        requirePhone: false,
      }),
    },
    privacyText: {
      type: String,
      trim: true,
      maxlength: [500, 'Privacy text cannot exceed 500 characters'],
      default: "We'll never spam. Unsubscribe anytime.",
    },

    // Questions and Results
    questions: {
      type: [quizQuestionSchema],
      default: [],
    },
    results: {
      type: [quizResultSchema],
      default: [],
    },

    // Styling
    theme: {
      type: String,
      enum: {
        values: ['dark', 'light', 'colorful'],
        message: 'Theme must be one of: dark, light, colorful',
      },
      default: 'dark',
    },
    primaryColor: {
      type: String,
      trim: true,
      default: '#10B981',
    },
    accentColor: {
      type: String,
      trim: true,
      default: '#6366F1',
    },
    logoUrl: {
      type: String,
      trim: true,
    },
    fontStyle: {
      type: String,
      enum: {
        values: ['modern', 'classic', 'playful'],
        message: 'Font style must be one of: modern, classic, playful',
      },
      default: 'modern',
    },

    // Analytics
    stats: {
      type: quizStatsSchema,
      default: () => ({
        views: 0,
        starts: 0,
        completions: 0,
        emailsCaptured: 0,
      }),
    },

    // Status
    status: {
      type: String,
      enum: {
        values: ['draft', 'published'],
        message: 'Status must be either draft or published',
      },
      default: 'draft',
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
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
quizSchema.index({ userId: 1, slug: 1 }, { unique: true });
quizSchema.index({ userId: 1, createdAt: -1 });
quizSchema.index({ status: 1 });
quizSchema.index({ isPublic: 1, createdAt: -1 });

// ============================================
// Virtual for response count
// ============================================

quizSchema.virtual('responseCount', {
  ref: 'QuizResponse',
  localField: '_id',
  foreignField: 'quizId',
  count: true,
});

// ============================================
// Transform for JSON
// ============================================

quizSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

quizSchema.set('toObject', { virtuals: true });

export const Quiz = mongoose.model<IQuiz>('Quiz', quizSchema);

