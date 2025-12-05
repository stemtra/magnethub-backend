import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { scrapeWebsite, formatScrapedContentForPrompt, extractBrandFromWebsite, type ExtractedBrand } from './scraperService.js';
import { scrapeInstagramProfile, formatInstagramProfileForPrompt, isInstagramUrl } from './instagramService.js';
import { scrapeYouTubeChannel, formatYouTubeChannelForPrompt, isYouTubeUrl } from './youtubeService.js';
import type {
  IBusinessMeta,
  IOutline,
  ILeadMagnetContent,
  ILandingPageCopy,
  IEmailSequence,
  LeadMagnetType,
  LeadMagnetTone,
  LeadMagnetGoal,
  IBrandSettings,
  SourceType,
  IInstagramProfile,
  IYouTubeChannel,
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
    // Combine system and user prompts for the Responses API
    const input = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    
    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input,
      text: {
        format: {
          type: 'json_object',
        },
      },
    });

    const content = response.output_text;
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
// Call #1 (Alternative): Instagram Profile Understanding
// ============================================

export async function analyzeInstagramProfile(
  input: string,
  audience?: string
): Promise<{ meta: IBusinessMeta; profile: IInstagramProfile }> {
  logger.info('AI Call #1: Instagram Profile Understanding', { input });

  const profile = await scrapeInstagramProfile(input);
  const formattedContent = formatInstagramProfileForPrompt(profile);

  const systemPrompt = `You are an expert at analyzing social media creators and influencers.
Analyze this Instagram profile and extract business insights.

You're given:
- Profile bio (short, often includes emojis and line breaks)
- Recent post captions (informal, may include hashtags)
- Follower count and engagement metrics

From this, infer:
1. What services, products, or value this creator offers
2. Their niche/expertise area
3. Who their target audience is (based on content style and topics)
4. Their brand voice (casual, professional, motivational, educational, etc.)
5. Pain points they address in their content
6. Key benefits they provide to followers/customers

IMPORTANT: Many creators don't explicitly sell products - they might offer:
- Educational content / courses / coaching
- Entertainment / inspiration
- Community / lifestyle content
- Affiliate recommendations
- Services (consulting, design, etc.)

Infer what makes sense based on their content.

Return a JSON object with this structure:
{
  "business_summary": "2-3 sentence summary of what this creator does/offers",
  "product_service_list": ["inferred products, services, or content types"],
  "icp": "Their ideal follower/customer based on content",
  "pain_points": ["problems they help solve or address"],
  "tone_indicators": ["words describing their brand voice"],
  "benefits": ["value they provide to their audience"],
  "category": "creator niche/industry",
  "keywords": ["relevant keywords from their content"]
}`;

  const userPrompt = `Analyze this Instagram creator${audience ? ` for the target audience: "${audience}"` : ''}:

${formattedContent}

Infer their business/offering and target audience from this social presence.`;

  const meta = await callOpenAI<IBusinessMeta>(systemPrompt, userPrompt);
  return { meta, profile };
}

// ============================================
// Call #1 (Alternative): YouTube Channel Understanding
// ============================================

export async function analyzeYouTubeChannel(
  input: string,
  audience?: string
): Promise<{ meta: IBusinessMeta; channel: IYouTubeChannel }> {
  logger.info('AI Call #1: YouTube Channel Understanding', { input });

  const channel = await scrapeYouTubeChannel(input);
  const formattedContent = formatYouTubeChannelForPrompt(channel);

  const systemPrompt = `You are an expert at analyzing YouTube creators and content channels.
Analyze this YouTube channel and extract business insights.

You're given:
- Channel name and description
- Subscriber count and video count
- Recent video titles and view counts

From this, infer:
1. What value, services, or products this creator offers
2. Their content niche/expertise area
3. Who their target audience is (based on video topics and style)
4. Their brand voice (educational, entertaining, professional, casual, etc.)
5. Pain points they address in their content
6. Key benefits they provide to viewers

IMPORTANT: YouTube creators monetize in various ways:
- Ad revenue / sponsorships
- Courses / digital products
- Coaching / consulting
- Membership / Patreon
- Affiliate marketing
- Services related to their niche

Infer what makes sense based on their content.

Return a JSON object with this structure:
{
  "business_summary": "2-3 sentence summary of what this creator does/offers",
  "product_service_list": ["inferred products, services, or content types"],
  "icp": "Their ideal viewer/customer based on content",
  "pain_points": ["problems they help solve or address"],
  "tone_indicators": ["words describing their brand voice"],
  "benefits": ["value they provide to their audience"],
  "category": "creator niche/industry",
  "keywords": ["relevant keywords from their content"]
}`;

  const userPrompt = `Analyze this YouTube creator${audience ? ` for the target audience: "${audience}"` : ''}:

${formattedContent}

Infer their business/offering and target audience from this YouTube presence.`;

  const meta = await callOpenAI<IBusinessMeta>(systemPrompt, userPrompt);
  return { meta, channel };
}

// ============================================
// Call #2: Outline Generation
// ============================================

export async function generateOutline(
  businessMeta: IBusinessMeta,
  type: LeadMagnetType,
  sourceType: SourceType = 'website'
): Promise<IOutline> {
  logger.info('AI Call #2: Outline Generation', { type, sourceType });

  const typeDescriptions: Record<LeadMagnetType, string> = {
    guide: 'A comprehensive guide with 5-7 sections, providing in-depth knowledge and actionable advice.',
    checklist: 'A practical checklist with 10-15 items, easy to follow and implement immediately.',
    mistakes: 'An educational piece highlighting 5-7 common mistakes and how to avoid/fix them.',
    blueprint: 'A step-by-step framework or blueprint with 4-6 phases/stages for achieving a specific outcome.',
    swipefile: 'A collection of 8-12 ready-to-use templates with fill-in-the-blank sections. Each template should be practical and immediately usable.',
    cheatsheet: 'A dense, single-page quick reference with formulas, shortcuts, key concepts, and essential information organized in scannable sections.',
    casestudy: 'A compelling success story following the Challenge → Solution → Results format, with specific metrics and a clear transformation narrative.',
  };

  const isCreator = sourceType === 'instagram' || sourceType === 'youtube';
  const platformName = sourceType === 'youtube' ? 'YouTube' : sourceType === 'instagram' ? 'Instagram' : '';
  
  const creatorContext = isCreator
    ? `\n\nIMPORTANT: This lead magnet is for a ${platformName} creator/influencer.
Their audience discovered them on ${platformName}, so they likely prefer:
- Casual, relatable tone that matches the creator's voice
- ${sourceType === 'youtube' ? 'Video-style explanations and visual examples' : 'Visual examples, screenshots, or templates'}
- Quick wins and actionable tips they can implement immediately
- Content that feels like "insider knowledge" from a creator they follow
- Personal stories and behind-the-scenes insights`
    : '';

  const systemPrompt = `You are an expert content strategist specializing in lead magnets.
Create an outline for a ${type} lead magnet.
${typeDescriptions[type]}${creatorContext}

Return a JSON object:
{
  "title_options": ["3 compelling title options"],
  "subtitle_options": ["3 subtitle options"],
  "sections": [
    {"title": "Section title", "purpose": "What this section will cover"}
  ],
  "cta_concept": "The main call-to-action concept"
}`;

  const businessLabel = isCreator ? 'Creator' : 'Business';
  const userPrompt = `Create a ${type} outline for this ${businessLabel.toLowerCase()}:

${businessLabel}: ${businessMeta.business_summary}
Target ${isCreator ? 'Audience' : 'Customer'}: ${businessMeta.icp}
Pain Points: ${businessMeta.pain_points.join(', ')}
Benefits: ${businessMeta.benefits.join(', ')}
${sourceType === 'instagram' ? 'Niche' : 'Industry'}: ${businessMeta.category}

Create an outline that directly addresses their pain points and positions the ${businessLabel.toLowerCase()} as the solution.`;

  return callOpenAI<IOutline>(systemPrompt, userPrompt);
}

// ============================================
// Call #3: Content Generation
// ============================================

export async function generateContent(
  businessMeta: IBusinessMeta,
  outline: IOutline,
  type: LeadMagnetType,
  tone: LeadMagnetTone,
  sourceType: SourceType = 'website'
): Promise<ILeadMagnetContent> {
  logger.info('AI Call #3: Content Generation', { type, tone, sourceType });

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
    swipefile: 'Write 8-12 complete templates, each with a title, context for when to use it, and the full copy-paste template with [BRACKETED] placeholders for customization (5-10 pages total).',
    cheatsheet: 'Write dense, scannable content organized into 4-6 categories. Use bullet points, short phrases, formulas, and quick tips. Prioritize information density over explanation (1-2 pages total).',
    casestudy: 'Write a narrative case study with: Background (who the client was), Challenge (the problem they faced), Solution (what was implemented), Results (specific metrics and outcomes), and Key Takeaways (3-5 pages total).',
  };

  const isCreator = sourceType === 'instagram' || sourceType === 'youtube';
  const platformName = sourceType === 'youtube' ? 'YouTube' : sourceType === 'instagram' ? 'Instagram' : '';
  
  const creatorContext = isCreator
    ? `\n\nIMPORTANT CONTEXT: This lead magnet is for a ${platformName} creator.
Their audience expects:
- Conversational, authentic voice (not corporate or stiff)
- ${sourceType === 'youtube' ? 'The same energy and style as their videos' : 'Emojis are acceptable if it fits the tone'}
- Personal stories and behind-the-scenes insights
- Actionable tips they can implement immediately
- The creator's unique perspective and methodology
- Content that feels like advice from someone they follow, not a company

Avoid:
- Overly formal or corporate language
- Generic business speak
- Content that feels disconnected from their ${platformName} personality`
    : '';

  const systemPrompt = `You are an expert content writer creating a ${type} lead magnet.

Tone: ${toneDescriptions[tone]}
Length: ${lengthGuides[type]}${creatorContext}

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

  const contextLabel = isCreator ? 'Creator Context' : 'Business Context';
  const userPrompt = `Write the full content for this ${type}:

Outline:
Title options: ${outline.title_options.join(' | ')}
Sections: ${outline.sections.map(s => s.title).join(', ')}

${contextLabel}:
- ${businessMeta.business_summary}
- Target: ${businessMeta.icp}
- Pain Points: ${businessMeta.pain_points.join(', ')}
- Benefits: ${businessMeta.benefits.join(', ')}

Write compelling, actionable content for each section.`;

  return callOpenAI<ILeadMagnetContent>(systemPrompt, userPrompt);
}

// ============================================
// Call #4: Landing Page Copy (Copy Only - No HTML)
// ============================================

export async function generateLandingPageCopy(
  businessMeta: IBusinessMeta,
  content: ILeadMagnetContent,
  sourceType: SourceType = 'website'
): Promise<ILandingPageCopy> {
  logger.info('AI Call #4: Landing Page Copy Generation', { sourceType });

  const isCreator = sourceType === 'instagram' || sourceType === 'youtube';
  const platformName = sourceType === 'youtube' ? 'YouTube' : sourceType === 'instagram' ? 'Instagram' : '';
  
  const creatorContext = isCreator
    ? `\n\nIMPORTANT: This landing page is for a ${platformName} creator's audience.
The copy should:
- Sound like it was written by the creator, not a marketing team
- Feel like a personal invitation ${sourceType === 'youtube' ? 'from their video description' : 'or DM'}
- Use language patterns common on social media (casual, direct)
- Create FOMO for followers who haven't grabbed this yet
- Reference their expertise/content in an authentic way`
    : '';

  const systemPrompt = `You are an expert landing page copywriter specializing in high-converting lead magnet pages.
Create compelling, benefit-focused copy that drives email signups.${creatorContext}

Return a JSON object with ONLY the copy (no HTML):
{
  "headline": "Main headline - attention-grabbing, benefit-focused, max 10 words",
  "subheadline": "Supporting subheadline that expands on the headline - 1-2 sentences",
  "benefit_bullets": ["3-5 short benefit statements starting with action verbs"],
  "cta": "CTA button text - action-oriented, 2-4 words",
  "short_description": "1-2 sentence SEO-friendly description for meta tags"
}

Guidelines:
- Headline should create curiosity or promise a specific benefit
- Subheadline should address the main pain point
- Benefits should be specific and actionable (not vague platitudes)
- CTA should create urgency without being pushy (e.g., "Get Free Access", "Download Now", "Send Me The Guide")
- Keep it concise - landing pages work best with minimal text`;

  const contextLabel = isCreator ? 'Creator' : 'Business';
  const audienceLabel = 'Target Audience';
  
  const userPrompt = `Create landing page copy for this lead magnet:

Title: ${content.title}
Subtitle: ${content.subtitle}

${contextLabel}: ${businessMeta.business_summary}
${audienceLabel}: ${businessMeta.icp}
Key Pain Points: ${businessMeta.pain_points.join(', ')}
Key Benefits: ${businessMeta.benefits.join(', ')}

Sections covered:
${content.sections.map(s => `- ${s.title}`).join('\n')}

Original CTA concept: ${content.cta}

Write compelling, conversion-focused copy.`;

  const result = await callOpenAI<Omit<ILandingPageCopy, 'html'>>(systemPrompt, userPrompt);
  
  // Return with empty html field (template will be used instead)
  return {
    ...result,
    html: '', // No longer generating HTML - using templates
  };
}

// ============================================
// Call #5: Email Sequence
// ============================================

export async function generateEmailSequence(
  businessMeta: IBusinessMeta,
  content: ILeadMagnetContent,
  pdfUrl: string,
  tone: LeadMagnetTone,
  goal: LeadMagnetGoal,
  sourceType: SourceType = 'website'
): Promise<IEmailSequence> {
  logger.info('AI Call #5: Email Sequence Generation', { goal, sourceType });

  const toneDescriptions: Record<LeadMagnetTone, string> = {
    professional: 'Professional and polished',
    friendly: 'Warm and conversational',
    expert: 'Authoritative and educational',
    persuasive: 'Compelling and action-oriented',
  };

  // Goal-specific email sequence strategies
  const goalStrategies: Record<LeadMagnetGoal, {
    description: string;
    sequence: string;
    finalCta: string;
  }> = {
    get_leads: {
      description: 'Build trust and nurture the relationship. The goal is to keep subscribers engaged and warm for future opportunities.',
      sequence: `1. Delivery - Deliver the lead magnet with PDF link
2. Value - Provide additional tips or insights related to the content
3. Story - Share a relevant story or case study that builds connection
4. Soft CTA - Gentle mention of how you can help if they need more support
5. Value + Soft CTA - More value with a light reminder you're available to help`,
      finalCta: 'End with an open invitation like "Reply if you have any questions" or "Let us know if we can help" - keep it soft and relationship-focused.',
    },
    sell_call: {
      description: 'Move leads toward booking a discovery/sales call. Build urgency and demonstrate value of a conversation.',
      sequence: `1. Delivery - Deliver the lead magnet with PDF link
2. Value + Tease - Provide value while hinting there's more to discuss on a call
3. Authority - Establish credibility with results or expertise
4. Soft CTA - Offer a free call to discuss their specific situation
5. Hard CTA - Create urgency to book a call with clear next steps`,
      finalCta: 'End with a strong call-to-action to book a call. Use phrases like "Book a free strategy call", "Schedule a quick chat", or "Let\'s jump on a 15-minute call". Create urgency without being pushy.',
    },
    grow_list: {
      description: 'Build a loyal newsletter audience. Focus on pure value with no sales pressure - make them excited about future emails.',
      sequence: `1. Delivery - Deliver the lead magnet and welcome them to the community
2. Value - Share exclusive insights they won't find elsewhere
3. Value - More great content that makes them glad they subscribed
4. Community - Make them feel part of something special, share what's coming
5. Value + Engagement - Deliver value and encourage replies or engagement`,
      finalCta: 'End with excitement about future content. Use phrases like "See you next week!", "Stay tuned for more insights", or "Can\'t wait to share what\'s coming". NO sales pitch.',
    },
  };

  const strategy = goalStrategies[goal];

  // Extract business name from summary (first few words or use category)
  const businessName = businessMeta.business_summary.split(/[,.]/)![0]?.trim() || businessMeta.category;

  const systemPrompt = `You are an expert email copywriter creating a 5-email nurture sequence.

GOAL: ${strategy.description}

Tone: ${toneDescriptions[tone]}

Email Sequence Structure:
${strategy.sequence}

${strategy.finalCta}

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

CRITICAL RULES:
- DO NOT use placeholder variables like [First Name], [Your Name], [Company], etc.
- Use generic greetings like "Hi there," or "Hey," instead of [First Name]
- Sign off with "The ${businessName} Team" or just "Best regards" - NO placeholders
- Keep emails concise (150-250 words each)
- Make them feel personal, not automated
- Include the PDF download link: ${pdfUrl} in the first email as a clickable link
- Stay true to the GOAL - ${goal === 'get_leads' ? 'nurture without pushing sales' : goal === 'sell_call' ? 'drive toward booking a call' : 'build newsletter loyalty with pure value'}${sourceType === 'instagram' || sourceType === 'youtube' ? `

${sourceType === 'youtube' ? 'YOUTUBE' : 'INSTAGRAM'} CREATOR CONTEXT:
- These emails are from a ${sourceType === 'youtube' ? 'YouTube' : 'Instagram'} creator to their ${sourceType === 'youtube' ? 'subscribers' : 'followers'}
- Use a casual, friendly tone like messaging a friend
- Greetings like "Hey!" work better than "Dear subscriber"
- Sign off with the creator's name personally, not "The Team"
- Keep it short - creator audiences expect quick, valuable content
- Feel free to reference "${sourceType === 'youtube' ? 'my videos' : 'what I share on Instagram'}" or "${sourceType === 'youtube' ? 'my channel' : 'my posts'}"` : ''}`;

  const userPrompt = `Create a 5-email sequence for this lead magnet:

Lead Magnet: ${content.title}
Business: ${businessName}
Business Description: ${businessMeta.business_summary}
Target: ${businessMeta.icp}
Pain Points: ${businessMeta.pain_points.join(', ')}

Goal: ${goal === 'get_leads' ? 'Build email list and nurture relationships' : goal === 'sell_call' ? 'Get subscribers to book a sales/discovery call' : 'Grow a loyal newsletter audience'}

Remember: NO placeholder variables - use real greetings and the business name "${businessName}" for sign-offs.`;

  return callOpenAI<IEmailSequence>(systemPrompt, userPrompt);
}

// ============================================
// Full Pipeline
// ============================================

export interface PipelineResult {
  meta: IBusinessMeta;
  outline: IOutline;
  content: ILeadMagnetContent;
  landingPageCopy: ILandingPageCopy;
  emails: IEmailSequence;
  extractedBrand: IBrandSettings;
  sourceType: SourceType;
  instagramProfilePic?: string; // Profile picture URL for Instagram sources
  youtubeThumbnail?: string; // Channel thumbnail for YouTube sources
  sourceDescription?: string; // Description from scraped source (for caching)
}

export interface CachedSourceData {
  description: string;
  logoUrl?: string;
  brandSettings?: IBrandSettings;
}

export interface PipelineOptions {
  audience?: string;
  type: LeadMagnetType;
  tone: LeadMagnetTone;
  goal: LeadMagnetGoal;
  pdfUrl?: string;
  sourceType?: SourceType;
  cachedData?: CachedSourceData; // Skip scraping if we have cached brand data
}

export async function runFullPipeline(
  url: string,
  options: PipelineOptions
): Promise<PipelineResult> {
  // Auto-detect source type if not provided
  let sourceType: SourceType = options.sourceType || 'website';
  if (!options.sourceType) {
    if (isYouTubeUrl(url)) {
      sourceType = 'youtube';
    } else if (isInstagramUrl(url)) {
      sourceType = 'instagram';
    }
  }
  
  const hasCachedData = options.cachedData?.description;
  logger.info('Starting AI pipeline', { 
    url, 
    type: options.type, 
    sourceType,
    usingCache: !!hasCachedData,
  });

  let meta: IBusinessMeta;
  let extractedBrand: IBrandSettings;
  let instagramProfilePic: string | undefined;
  let youtubeThumbnail: string | undefined;
  let sourceDescription: string | undefined;

  // Default branding for social platforms
  const defaultSocialBrand: IBrandSettings = {
    primaryColor: '#0C0C0C',
    accentColor: '#10B981',
    backgroundColor: '#0C0C0C',
    textColor: '#FAFAFA',
    fontFamily: 'Plus Jakarta Sans',
    theme: 'dark',
  };

  // Use cached data if available (skip scraping to save resources)
  if (hasCachedData && options.cachedData) {
    logger.info('Using cached brand data - skipping web scraping');
    
    // Use cached brand settings or defaults
    extractedBrand = options.cachedData.brandSettings || defaultSocialBrand;
    instagramProfilePic = sourceType === 'instagram' ? options.cachedData.logoUrl : undefined;
    youtubeThumbnail = sourceType === 'youtube' ? options.cachedData.logoUrl : undefined;
    sourceDescription = options.cachedData.description;
    
    // Still need to analyze content - use cached description to create business meta
    meta = await analyzeFromCachedDescription(
      options.cachedData.description,
      sourceType,
      options.audience
    );
    logger.info('Call #1 complete: Analyzed from cached description');
  } else if (sourceType === 'youtube') {
    // YouTube flow: scrape channel, use default branding
    const result = await analyzeYouTubeChannel(url, options.audience);
    meta = result.meta;
    youtubeThumbnail = result.channel.thumbnailUrl;
    sourceDescription = result.channel.description;
    logger.info('Call #1 complete: YouTube channel analyzed', { 
      hasThumbnail: !!youtubeThumbnail,
      hasDescription: !!sourceDescription,
    });

    extractedBrand = defaultSocialBrand;
    logger.info('Using default branding for YouTube channel');
  } else if (sourceType === 'instagram') {
    // Instagram flow: scrape profile, use default branding
    const result = await analyzeInstagramProfile(url, options.audience);
    meta = result.meta;
    instagramProfilePic = result.profile.profilePicUrl;
    sourceDescription = result.profile.bio;
    logger.info('Call #1 complete: Instagram profile analyzed', { 
      hasProfilePic: !!instagramProfilePic,
      hasDescription: !!sourceDescription,
    });

    extractedBrand = defaultSocialBrand;
    logger.info('Using default branding for Instagram profile');
  } else {
    // Website flow: scrape website, extract brand
    const brandPromise = extractBrandFromWebsite(url);
    meta = await analyzeWebsite(url, options.audience);
    sourceDescription = meta.business_summary; // Use the analyzed summary
    logger.info('Call #1 complete: Website analyzed');
    
    extractedBrand = await brandPromise;
    logger.info('Brand extraction complete', { extractedBrand });
  }

  // Call #2: Outline Generation (source-aware)
  const outline = await generateOutline(meta, options.type, sourceType);
  logger.info('Call #2 complete: Outline generated');

  // Call #3: Content Generation (source-aware)
  const content = await generateContent(meta, outline, options.type, options.tone, sourceType);
  logger.info('Call #3 complete: Content generated');

  // Call #4: Landing Page Copy (source-aware)
  const landingPageCopy = await generateLandingPageCopy(meta, content, sourceType);
  logger.info('Call #4 complete: Landing page copy generated');

  // Call #5: Email Sequence (source-aware)
  const pdfUrl = options.pdfUrl || `{{PDF_URL}}`;
  const emails = await generateEmailSequence(meta, content, pdfUrl, options.tone, options.goal, sourceType);
  logger.info('Call #5 complete: Email sequence generated');

  logger.info('AI pipeline complete', { sourceType });

  return {
    meta,
    outline,
    content,
    landingPageCopy,
    emails,
    extractedBrand,
    sourceType,
    instagramProfilePic,
    youtubeThumbnail,
    sourceDescription,
  };
}

// ============================================
// Analyze from Cached Description (Skip Scraping)
// ============================================

async function analyzeFromCachedDescription(
  description: string,
  sourceType: SourceType,
  audience?: string
): Promise<IBusinessMeta> {
  logger.info('Analyzing from cached description', { sourceType });

  const contextType = sourceType === 'youtube' ? 'YouTube channel' 
    : sourceType === 'instagram' ? 'Instagram profile' 
    : 'business website';

  const systemPrompt = `You are an expert at analyzing ${contextType}s.
Given a description/bio, extract business insights.

Return a JSON object with this structure:
{
  "business_summary": "2-3 sentence summary of what this ${sourceType === 'website' ? 'business' : 'creator'} does/offers",
  "product_service_list": ["products, services, or content types offered"],
  "icp": "Their ideal ${sourceType === 'website' ? 'customer' : 'follower/viewer'}",
  "pain_points": ["problems they help solve"],
  "tone_indicators": ["words describing their brand voice"],
  "benefits": ["value they provide"],
  "category": "niche/industry",
  "keywords": ["relevant keywords"]
}`;

  const userPrompt = `Analyze this ${contextType} description${audience ? ` for the target audience: "${audience}"` : ''}:

${description}

Infer their offering and target audience from this description.`;

  return callOpenAI<IBusinessMeta>(systemPrompt, userPrompt);
}

