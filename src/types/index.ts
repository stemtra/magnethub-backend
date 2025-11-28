import type { Request } from 'express';
import type { Document, Types } from 'mongoose';

// ============================================
// User Types
// ============================================

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password?: string;
  name: string;
  username: string;
  googleId?: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IUserPublic {
  id: string;
  email: string;
  name: string;
  username: string;
  createdAt: Date;
}

// ============================================
// Lead Magnet Types
// ============================================

export type LeadMagnetGoal = 'get_leads' | 'sell_call' | 'grow_list';
export type LeadMagnetType = 'guide' | 'checklist' | 'mistakes' | 'blueprint';
export type LeadMagnetTone = 'professional' | 'friendly' | 'expert' | 'persuasive';

export interface ILeadMagnet extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  websiteUrl: string;
  audience?: string;
  goal: LeadMagnetGoal;
  type: LeadMagnetType;
  tone: LeadMagnetTone;
  pdfUrl?: string;
  landingPageHtml?: string;
  emailsJson?: IEmailSequence;
  outlineJson?: IOutline;
  metaJson?: IBusinessMeta;
  contentJson?: ILeadMagnetContent;
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
  createdAt: Date;
}

// ============================================
// AI Pipeline Types
// ============================================

// Call #1 Output - Website Understanding
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

