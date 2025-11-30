import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import type { IUser, IBrandSettings } from '../types/index.js';

// Sub-schema for brand settings
const brandSettingsSchema = new Schema<IBrandSettings>(
  {
    primaryColor: { type: String, default: '#0C0C0C' },
    accentColor: { type: String, default: '#10B981' },
    backgroundColor: { type: String, default: '#0C0C0C' },
    textColor: { type: String, default: '#FAFAFA' },
    fontFamily: { type: String, default: 'Plus Jakarta Sans' },
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    logoUrl: { type: String },
    landingPageTemplate: { 
      type: String, 
      enum: ['minimal', 'bold', 'split', 'classic'], 
      default: 'minimal' 
    },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't include password in queries by default
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
      match: [/^[a-z0-9_-]+$/, 'Username can only contain lowercase letters, numbers, hyphens, and underscores'],
    },
    googleId: {
      type: String,
      sparse: true, // Allow null/undefined but ensure uniqueness when present
      unique: true,
    },
    brandSettings: {
      type: brandSettingsSchema,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================
// Indexes
// ============================================

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });

// ============================================
// Pre-save Middleware
// ============================================

userSchema.pre('save', async function (next) {
  // Only hash password if it's modified (or new)
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// ============================================
// Instance Methods
// ============================================

userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// ============================================
// Transform for JSON
// ============================================

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    return ret;
  },
});

export const User = mongoose.model<IUser>('User', userSchema);

