import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { scrapeWebsite, formatScrapedContentForPrompt } from './scraperService.js';
import type {
  IBusinessMeta,
  IOutline,
  ILeadMagnetContent,
  ILandingPageCopy,
  IEmailSequence,
  LeadMagnetType,
  LeadMagnetTone,
  LeadMagnetGoal,
} from '../types/index.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// ============================================
// Helper Functions
// ============================================

async function callOpenAI<T>(
  systemPrompt: string,
  userPrompt: string,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    return JSON.parse(content) as T;
  } catch (error) {
    if (retries > 0) {
      logger.warn('OpenAI call failed, retrying...', { retriesLeft: retries - 1 });
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return callOpenAI<T>(systemPrompt, userPrompt, retries - 1);
    }

    logger.error('OpenAI call failed after retries', error);
    throw AppError.internal('AI service temporarily unavailable. Please try again.');
  }
}

// ============================================
// Call #1: Website Understanding
// ============================================

export async function analyzeWebsite(
  url: string,
  audience?: string
): Promise<IBusinessMeta> {
  logger.info('AI Call #1: Website Understanding', { url });

  const scrapedContent = await scrapeWebsite(url);
  const formattedContent = formatScrapedContentForPrompt(scrapedContent);

  const systemPrompt = `You are an expert business analyst. Analyze the provided website content and extract key business insights.
Return a JSON object with the following structure:
{
  "business_summary": "2-3 sentence summary of what the business does",
  "product_service_list": ["list", "of", "products", "or", "services"],
  "icp": "Ideal Customer Profile - who is the target customer",
  "pain_points": ["pain", "points", "customers", "have"],
  "tone_indicators": ["words", "describing", "brand", "tone"],
  "benefits": ["key", "benefits", "offered"],
  "category": "business category/industry",
  "keywords": ["relevant", "keywords"]
}`;

  const userPrompt = `Analyze this website content${audience ? ` for the target audience: "${audience}"` : ''}:

${formattedContent}

Extract comprehensive business insights.`;

  return callOpenAI<IBusinessMeta>(systemPrompt, userPrompt);
}

// ============================================
// Call #2: Outline Generation
// ============================================

export async function generateOutline(
  businessMeta: IBusinessMeta,
  type: LeadMagnetType
): Promise<IOutline> {
  logger.info('AI Call #2: Outline Generation', { type });

  const typeDescriptions: Record<LeadMagnetType, string> = {
    guide: 'A comprehensive guide with 5-7 sections, providing in-depth knowledge and actionable advice.',
    checklist: 'A practical checklist with 10-15 items, easy to follow and implement immediately.',
    mistakes: 'An educational piece highlighting 5-7 common mistakes and how to avoid/fix them.',
    blueprint: 'A step-by-step framework or blueprint with 4-6 phases/stages for achieving a specific outcome.',
  };

  const systemPrompt = `You are an expert content strategist specializing in lead magnets.
Create an outline for a ${type} lead magnet.
${typeDescriptions[type]}

Return a JSON object:
{
  "title_options": ["3 compelling title options"],
  "subtitle_options": ["3 subtitle options"],
  "sections": [
    {"title": "Section title", "purpose": "What this section will cover"}
  ],
  "cta_concept": "The main call-to-action concept"
}`;

  const userPrompt = `Create a ${type} outline for this business:

Business: ${businessMeta.business_summary}
Target Customer: ${businessMeta.icp}
Pain Points: ${businessMeta.pain_points.join(', ')}
Benefits: ${businessMeta.benefits.join(', ')}
Industry: ${businessMeta.category}

Create an outline that directly addresses their pain points and positions the business as the solution.`;

  return callOpenAI<IOutline>(systemPrompt, userPrompt);
}

// ============================================
// Call #3: Content Generation
// ============================================

export async function generateContent(
  businessMeta: IBusinessMeta,
  outline: IOutline,
  type: LeadMagnetType,
  tone: LeadMagnetTone
): Promise<ILeadMagnetContent> {
  logger.info('AI Call #3: Content Generation', { type, tone });

  const toneDescriptions: Record<LeadMagnetTone, string> = {
    professional: 'Formal, authoritative, and polished. Use industry terminology appropriately.',
    friendly: 'Warm, approachable, and conversational. Like talking to a helpful friend.',
    expert: 'Knowledgeable, detailed, and educational. Establish thought leadership.',
    persuasive: 'Compelling, benefit-focused, and action-oriented. Drive urgency and desire.',
  };

  const lengthGuides: Record<LeadMagnetType, string> = {
    guide: 'Write comprehensive content with 300-500 words per section (10-15 pages total).',
    checklist: 'Write concise bullet points with brief explanations (1-3 pages total).',
    mistakes: 'Write 200-300 words per mistake, including the problem and solution (3-6 pages total).',
    blueprint: 'Write clear step-by-step instructions with 200-400 words per step (5-8 pages total).',
  };

  const systemPrompt = `You are an expert content writer creating a ${type} lead magnet.

Tone: ${toneDescriptions[tone]}
Length: ${lengthGuides[type]}

Return a JSON object:
{
  "title": "The final title",
  "subtitle": "The subtitle",
  "sections": [
    {"title": "Section title", "content": "Full section content with formatting"}
  ],
  "cta": "Call to action text"
}

Use markdown formatting in the content (headers, bullets, bold, etc.).
Make the content actionable, valuable, and directly relevant to the target audience.`;

  const userPrompt = `Write the full content for this ${type}:

Outline:
Title options: ${outline.title_options.join(' | ')}
Sections: ${outline.sections.map(s => s.title).join(', ')}

Business Context:
- ${businessMeta.business_summary}
- Target: ${businessMeta.icp}
- Pain Points: ${businessMeta.pain_points.join(', ')}
- Benefits: ${businessMeta.benefits.join(', ')}

Write compelling, actionable content for each section.`;

  return callOpenAI<ILeadMagnetContent>(systemPrompt, userPrompt);
}

// ============================================
// Call #4: Landing Page Copy
// ============================================

export async function generateLandingPage(
  businessMeta: IBusinessMeta,
  outline: IOutline,
  content: ILeadMagnetContent,
  username: string,
  slug: string
): Promise<ILandingPageCopy> {
  logger.info('AI Call #4: Landing Page Generation', { username, slug });

  const formActionUrl = `/public/${username}/${slug}/subscribe`;

  const systemPrompt = `You are an expert landing page copywriter and web designer.
Create compelling landing page copy AND generate the complete HTML.

Return a JSON object:
{
  "headline": "Main headline (attention-grabbing)",
  "subheadline": "Supporting subheadline",
  "benefit_bullets": ["3-5 benefit bullets"],
  "cta": "CTA button text",
  "short_description": "1-2 sentence description",
  "html": "Complete HTML code"
}

The HTML must:
1. Use inline CSS only (no external stylesheets)
2. Have a minimalist, elegant beige/cream color scheme (#FAF8F5 background, #2C2C2C text)
3. Include an email capture form with action="${formActionUrl}" method="POST"
4. Include a "Powered by MagnetHub" footer link
5. Be mobile-responsive
6. Have NO JavaScript

Structure:
- Hero section with headline, subheadline
- Benefits section with bullet points
- Email capture form with input and submit button
- Footer with MagnetHub attribution`;

  const userPrompt = `Create a landing page for this lead magnet:

Title: ${content.title}
Subtitle: ${content.subtitle}

Business: ${businessMeta.business_summary}
Target Audience: ${businessMeta.icp}
Key Benefits: ${businessMeta.benefits.join(', ')}

Sections covered:
${content.sections.map(s => `- ${s.title}`).join('\n')}

CTA: ${content.cta}

Create high-converting copy and beautiful HTML.`;

  return callOpenAI<ILandingPageCopy>(systemPrompt, userPrompt);
}

// ============================================
// Call #5: Email Sequence
// ============================================

export async function generateEmailSequence(
  businessMeta: IBusinessMeta,
  content: ILeadMagnetContent,
  pdfUrl: string,
  tone: LeadMagnetTone
): Promise<IEmailSequence> {
  logger.info('AI Call #5: Email Sequence Generation');

  const toneDescriptions: Record<LeadMagnetTone, string> = {
    professional: 'Professional and polished',
    friendly: 'Warm and conversational',
    expert: 'Authoritative and educational',
    persuasive: 'Compelling and action-oriented',
  };

  const systemPrompt = `You are an expert email copywriter creating a 5-email nurture sequence.

Tone: ${toneDescriptions[tone]}

Email Sequence:
1. Delivery - Deliver the lead magnet with PDF link
2. Value - Provide additional value/tips related to the content
3. Story/Authority - Share a story or establish authority
4. Soft CTA - Gentle mention of how to work together
5. Hard CTA - Clear call to action to take next step

Return a JSON object:
{
  "emails": [
    {
      "title": "Delivery",
      "subject": "Email subject line",
      "body_text": "Plain text version",
      "body_html": "HTML version with basic formatting"
    },
    // ... 4 more emails
  ]
}

Keep emails concise (150-250 words each).
Make them feel personal, not automated.
Include the PDF download link: ${pdfUrl} in the first email.`;

  const userPrompt = `Create a 5-email sequence for this lead magnet:

Lead Magnet: ${content.title}
Business: ${businessMeta.business_summary}
Target: ${businessMeta.icp}
Pain Points: ${businessMeta.pain_points.join(', ')}

The sequence should nurture leads toward becoming customers.`;

  return callOpenAI<IEmailSequence>(systemPrompt, userPrompt);
}

// ============================================
// Full Pipeline
// ============================================

export interface PipelineResult {
  meta: IBusinessMeta;
  outline: IOutline;
  content: ILeadMagnetContent;
  landingPage: ILandingPageCopy;
  emails: IEmailSequence;
}

export async function runFullPipeline(
  url: string,
  options: {
    audience?: string;
    type: LeadMagnetType;
    tone: LeadMagnetTone;
    goal: LeadMagnetGoal;
    username: string;
    slug: string;
    pdfUrl?: string;
  }
): Promise<PipelineResult> {
  logger.info('Starting AI pipeline', { url, type: options.type });

  // Call #1: Website Understanding
  const meta = await analyzeWebsite(url, options.audience);
  logger.info('Call #1 complete: Website analyzed');

  // Call #2: Outline Generation
  const outline = await generateOutline(meta, options.type);
  logger.info('Call #2 complete: Outline generated');

  // Call #3: Content Generation
  const content = await generateContent(meta, outline, options.type, options.tone);
  logger.info('Call #3 complete: Content generated');

  // Call #4: Landing Page (needs username and slug for form action)
  const landingPage = await generateLandingPage(meta, outline, content, options.username, options.slug);
  logger.info('Call #4 complete: Landing page generated');

  // Call #5: Email Sequence (needs PDF URL - we'll use placeholder if not available yet)
  const pdfUrl = options.pdfUrl || `{{PDF_URL}}`;
  const emails = await generateEmailSequence(meta, content, pdfUrl, options.tone);
  logger.info('Call #5 complete: Email sequence generated');

  logger.info('AI pipeline complete');

  return {
    meta,
    outline,
    content,
    landingPage,
    emails,
  };
}

