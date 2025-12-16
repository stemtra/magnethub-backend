import type { Request } from 'express';
import type { Document, Types } from 'mongoose';

// ============================================
// Subscription Types
// ============================================

export type PlanType = 'free' | 'starter' | 'pro' | 'agency';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';

export interface ISubscription extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  plan: PlanType;
  status: SubscriptionStatus;
  
  // Stripe integration
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  
  // Billing periods
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  
  // Usage tracking
  leadMagnetsCreatedThisPeriod: number;
  
  // Lifecycle dates
  startedAt: Date;
  canceledAt?: Date;
  endedAt?: Date;
  
  // Metadata
  metadata?: {
    source?: string;
    cancelReason?: string;
    defaultPaymentMethodId?: string;
    cardBrand?: string;
    cardLast4?: string;
    cardExpMonth?: number;
    cardExpYear?: number;
    paymentFailureReason?: string;
    paymentFailedAt?: Date;
    lastInvoiceId?: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  isActive(): boolean;
  isPaid(): boolean;
  canCreateLeadMagnet(): boolean;
  getLeadMagnetsRemaining(): number;
}

// ============================================
// User Types
// ============================================

export type LandingPageTemplate = 'minimal' | 'bold' | 'split' | 'classic';

export interface IBrandSettings {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  theme: 'light' | 'dark';
  logoUrl?: string;
  landingPageTemplate?: LandingPageTemplate;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password?: string;
  name: string;
  username: string;
  googleId?: string;
  brandSettings?: IBrandSettings;
  // Stripe
  stripeCustomerId?: string;
  currentSubscriptionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IUserPublic {
  id: string;
  email: string;
  name: string;
  username: string;
  brandSettings?: IBrandSettings;
  plan?: PlanType;
  createdAt: Date;
}

// ============================================
// Shared Types
// ============================================

export type SourceType = 'website' | 'instagram' | 'youtube';

// ============================================
// Brand Types
// ============================================

export interface IBrand extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  sourceType: SourceType;
  sourceUrl: string;
  settings: IBrandSettings;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Lead Magnet Types
// ============================================

export type LeadMagnetGoal = 'get_leads' | 'sell_call' | 'grow_list';
export type LeadMagnetType = 
  | 'guide' 
  | 'checklist' 
  | 'mistakes' 
  | 'blueprint'
  | 'swipefile'
  | 'cheatsheet'
  | 'casestudy';
export type LeadMagnetTone = 'professional' | 'friendly' | 'expert' | 'persuasive';

export type LeadMagnetGenerationStatus = 'pdf_ready' | 'complete' | 'needs_attention';
export type LeadMagnetAssetStatus = 'pending' | 'ready' | 'failed';

export interface ILeadMagnet extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  brandId?: Types.ObjectId; // Reference to the brand used
  sourceType: SourceType;
  sourceUrl: string;
  websiteUrl?: string; // @deprecated - use sourceUrl instead
  audience?: string;
  goal: LeadMagnetGoal;
  type: LeadMagnetType;
  tone: LeadMagnetTone;
  pdfUrl?: string;
  landingPageHtml?: string;
  landingPageCopyJson?: ILandingPageCopy;
  emailsJson?: IEmailSequence;
  outlineJson?: IOutline;
  metaJson?: IBusinessMeta;
  contentJson?: ILeadMagnetContent;
  generationStatus?: LeadMagnetGenerationStatus;
  landingStatus?: LeadMagnetAssetStatus;
  emailsStatus?: LeadMagnetAssetStatus;
  generationError?: string;
  slug: string;
  title?: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Lead Types
// ============================================

export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface ILead extends Document {
  _id: Types.ObjectId;
  email: string;
  leadMagnetId: Types.ObjectId;
  deliveryStatus: DeliveryStatus;
  // Source tracking
  referrer?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  createdAt: Date;
}

// ============================================
// PageView Types
// ============================================

export interface IPageView extends Document {
  _id: Types.ObjectId;
  leadMagnetId: Types.ObjectId;
  referrer?: string;
  source: string;
  medium?: string;
  campaign?: string;
  userAgent?: string;
  ip?: string;
  country?: string;
  createdAt: Date;
}

// ============================================
// Quiz Types
// ============================================

export type QuizStatus = 'draft' | 'published';
export type EmailCapturePoint = 'before_results' | 'after_results';
export type QuizTheme = 'dark' | 'light' | 'colorful';
export type QuizFontStyle = 'modern' | 'classic' | 'playful';
export type QuizEmailDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface IQuizAnswer {
  _id: Types.ObjectId;
  answerText: string;
  resultMapping?: Types.ObjectId; // Maps to which result this points to
}

export interface IQuizQuestion {
  _id: Types.ObjectId;
  questionText: string;
  order: number;
  answers: IQuizAnswer[];
}

export interface IQuizResult {
  _id: Types.ObjectId;
  name: string;
  emoji?: string;
  summary: string;
  traits: string[];
  recommendation?: string;
  ctaText?: string;
  ctaUrl?: string;
  imageUrl?: string;
}

export interface IQuizEmailFields {
  requireEmail: boolean;
  requireName: boolean;
  requirePhone: boolean;
}

export interface IQuizStats {
  views: number;
  starts: number;
  completions: number;
  emailsCaptured: number;
}

export interface IQuiz extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  brandId?: Types.ObjectId;
  title: string;
  subtitle?: string;
  coverImageUrl?: string;
  slug: string;

  // Email capture settings
  emailCapturePoint: EmailCapturePoint;
  emailFields: IQuizEmailFields;
  privacyText?: string;

  // Questions and Results
  questions: IQuizQuestion[];
  results: IQuizResult[];

  // Styling
  theme: QuizTheme;
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  fontStyle: QuizFontStyle;

  // Analytics
  stats: IQuizStats;

  // Status
  status: QuizStatus;

  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// QuizResponse Types
// ============================================

export interface IQuizResponseAnswer {
  questionId: Types.ObjectId;
  answerId: Types.ObjectId;
  timestamp: Date;
}

export interface IQuizResponse extends Document {
  _id: Types.ObjectId;
  quizId: Types.ObjectId;

  // User info
  email?: string;
  firstName?: string;
  phone?: string;

  // Quiz data
  answers: IQuizResponseAnswer[];
  resultId?: Types.ObjectId;

  // Timestamps
  startedAt?: Date;
  completedAt?: Date;
  emailCapturedAt?: Date;

  // Technical metadata
  ipAddress?: string;
  userAgent?: string;

  // Source tracking
  referrer?: string;
  source?: string;
  medium?: string;
  campaign?: string;

  // Email delivery
  emailDeliveryStatus: QuizEmailDeliveryStatus;

  createdAt: Date;
  updatedAt?: Date;
}

// ============================================
// Instagram Profile Types
// ============================================

export interface IInstagramPost {
  caption: string;
  likes: number;
  comments: number;
  isVideo: boolean;
  timestamp?: string;
}

export interface IInstagramProfile {
  username: string;
  fullName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl?: string;
  isVerified: boolean;
  recentPosts: IInstagramPost[];
}

// ============================================
// YouTube Channel Types
// ============================================

export interface IYouTubeVideo {
  title: string;
  description: string;
  viewCount: number;
  likeCount: number;
  publishedAt?: string;
}

export interface IYouTubeChannel {
  channelId: string;
  handle?: string;
  name: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl?: string;
  bannerUrl?: string;
  isVerified: boolean;
  recentVideos: IYouTubeVideo[];
}

// ============================================
// AI Pipeline Types
// ============================================

// Call #1 Output - Website/Profile Understanding
export interface IBusinessMeta {
  business_summary: string;
  product_service_list: string[];
  icp: string;
  pain_points: string[];
  tone_indicators: string[];
  benefits: string[];
  category: string;
  keywords: string[];
}

// Call #2 Output - Outline Generation
export interface IOutlineSection {
  title: string;
  purpose: string;
}

export interface IOutline {
  title_options: string[];
  subtitle_options: string[];
  sections: IOutlineSection[];
  cta_concept: string;
}

// Call #3 Output - Lead Magnet Content
export interface IContentSection {
  title: string;
  content: string;
}

export interface ILeadMagnetContent {
  title: string;
  subtitle: string;
  sections: IContentSection[];
  cta: string;
}

// Call #4 Output - Landing Page
export interface ILandingPageCopy {
  headline: string;
  subheadline: string;
  benefit_bullets: string[];
  cta: string;
  short_description: string;
  html: string;
}

// Call #5 Output - Email Sequence
export interface IEmail {
  title: string;
  subject: string;
  body_text: string;
  body_html: string;
}

export interface IEmailSequence {
  emails: IEmail[];
}

// ============================================
// Express Types
// ============================================

export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

