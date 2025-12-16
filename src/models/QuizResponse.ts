import mongoose, { Schema } from 'mongoose';
import type { IQuizResponse } from '../types/index.js';

// ============================================
// Sub-schemas
// ============================================

const quizResponseAnswerSchema = new Schema(
  {
    questionId: {
      type: Schema.Types.ObjectId,
      required: [true, 'Question ID is required'],
    },
    answerId: {
      type: Schema.Types.ObjectId,
      required: [true, 'Answer ID is required'],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ============================================
// Main QuizResponse Schema
// ============================================

const quizResponseSchema = new Schema<IQuizResponse>(
  {
    quizId: {
      type: Schema.Types.ObjectId,
      ref: 'Quiz',
      required: [true, 'Quiz ID is required'],
      index: true,
    },

    // User info
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: [100, 'First name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [50, 'Phone cannot exceed 50 characters'],
    },

    // Quiz data
    answers: {
      type: [quizResponseAnswerSchema],
      default: [],
    },
    resultId: {
      type: Schema.Types.ObjectId,
      // References a result within the quiz's results array
    },

    // Timestamps for funnel tracking
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    emailCapturedAt: {
      type: Date,
    },

    // Technical metadata
    ipAddress: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },

    // Source tracking (matching Lead.ts pattern)
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

    // Email delivery status
    emailDeliveryStatus: {
      type: String,
      enum: {
        values: ['pending', 'sent', 'failed', 'skipped'],
        message: 'Email delivery status must be one of: pending, sent, failed, skipped',
      },
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// Indexes
// ============================================

// Compound index to prevent duplicate emails per quiz
quizResponseSchema.index(
  { quizId: 1, email: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { email: { $exists: true, $ne: '' } }
  }
);
quizResponseSchema.index({ quizId: 1, createdAt: -1 });
quizResponseSchema.index({ resultId: 1 });
quizResponseSchema.index({ source: 1 });
quizResponseSchema.index({ emailDeliveryStatus: 1 });

// ============================================
// Transform for JSON
// ============================================

quizResponseSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const QuizResponse = mongoose.model<IQuizResponse>('QuizResponse', quizResponseSchema);

