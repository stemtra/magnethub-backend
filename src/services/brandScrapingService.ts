import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import {
  analyzeWebsite,
  analyzeInstagramProfile,
  analyzeYouTubeChannel,
} from './aiService.js';
import type { SourceType, IBusinessMeta, IInstagramProfile, IYouTubeChannel, IBrandSettings } from '../types/index.js';

// ============================================
// Types
// ============================================

export interface BrandContextResult {
  brandVoice: string;
  targetAudience: string;
  keyMessages: string[];
  scrapedContent: string;
  description: string;
  logoUrl?: string;
  brandSettings?: IBrandSettings;
}

// ============================================
// Extract Brand Context from Analysis
// ============================================

/**
 * Takes raw business analysis and extracts structured brand context
 */
function extractBrandContext(
  meta: IBusinessMeta,
  sourceType: SourceType,
  additionalData?: {
    bio?: string;
    description?: string;
    recentContent?: string[];
  }
): {
  brandVoice: string;
  targetAudience: string;
  keyMessages: string[];
  scrapedContent: string;
  description: string;
} {
  // Brand Voice: combine tone indicators into readable description
  const brandVoice = meta.tone_indicators.length > 0
    ? meta.tone_indicators.join(', ')
    : 'professional, informative';

  // Target Audience: use ICP (Ideal Customer Profile)
  const targetAudience = meta.icp || 'General audience';

  // Key Messages: combine top benefits and products/services
  const keyMessages: string[] = [];
  
  // Add top 3 benefits
  if (meta.benefits.length > 0) {
    keyMessages.push(...meta.benefits.slice(0, 3));
  }
  
  // Add top 2 products/services if space remains
  if (keyMessages.length < 5 && meta.product_service_list.length > 0) {
    const remaining = 5 - keyMessages.length;
    keyMessages.push(...meta.product_service_list.slice(0, remaining));
  }

  // Description: use business summary
  const description = meta.business_summary;

  // Scraped Content: create a summary of what was analyzed
  const contentParts: string[] = [
    `Summary: ${meta.business_summary}`,
    `Category: ${meta.category}`,
    `Products/Services: ${meta.product_service_list.join(', ')}`,
    `Pain Points: ${meta.pain_points.join(', ')}`,
  ];

  if (additionalData?.bio) {
    contentParts.unshift(`Bio: ${additionalData.bio}`);
  }
  if (additionalData?.description) {
    contentParts.unshift(`Description: ${additionalData.description}`);
  }
  if (additionalData?.recentContent && additionalData.recentContent.length > 0) {
    contentParts.push(`Recent Content: ${additionalData.recentContent.slice(0, 3).join(' | ')}`);
  }

  const scrapedContent = contentParts.join('\n');

  return {
    brandVoice,
    targetAudience,
    keyMessages,
    scrapedContent,
    description,
  };
}

// ============================================
// Main Scraping Function
// ============================================

/**
 * Scrapes and analyzes a brand source (website, Instagram, YouTube)
 * Returns structured brand context ready to store in Brand model
 */
export async function scrapeBrand(
  sourceUrl: string,
  sourceType: SourceType,
  audience?: string
): Promise<BrandContextResult> {
  logger.info('Starting brand scraping', { sourceUrl, sourceType });

  try {
    let meta: IBusinessMeta;
    let logoUrl: string | undefined;
    let brandSettings: IBrandSettings | undefined;
    let additionalData: any = {};

    // Default brand settings for social platforms
    const defaultSocialBrand: IBrandSettings = {
      primaryColor: '#0C0C0C',
      accentColor: '#10B981',
      backgroundColor: '#0C0C0C',
      textColor: '#FAFAFA',
      fontFamily: 'Plus Jakarta Sans',
      theme: 'dark',
    };

    switch (sourceType) {
      case 'youtube': {
        const result = await analyzeYouTubeChannel(sourceUrl, audience);
        meta = result.meta;
        logoUrl = result.channel.thumbnailUrl;
        brandSettings = defaultSocialBrand;
        
        additionalData = {
          description: result.channel.description,
          recentContent: result.channel.recentVideos.map(v => v.title),
        };
        
        logger.info('YouTube channel scraped successfully', {
          channelName: result.channel.name,
          subscribers: result.channel.subscriberCount,
        });
        break;
      }

      case 'instagram': {
        const result = await analyzeInstagramProfile(sourceUrl, audience);
        meta = result.meta;
        logoUrl = result.profile.profilePicUrl;
        brandSettings = defaultSocialBrand;
        
        additionalData = {
          bio: result.profile.bio,
          recentContent: result.profile.recentPosts.map(p => p.caption.substring(0, 100)),
        };
        
        logger.info('Instagram profile scraped successfully', {
          username: result.profile.username,
          followers: result.profile.followerCount,
        });
        break;
      }

      case 'website': {
        // For websites, we need to import and call the brand extraction
        const { extractBrandFromWebsite } = await import('./scraperService.js');
        
        meta = await analyzeWebsite(sourceUrl, audience);
        brandSettings = await extractBrandFromWebsite(sourceUrl);
        
        if (brandSettings.logoUrl) {
          logoUrl = brandSettings.logoUrl;
        }
        
        logger.info('Website scraped successfully', {
          category: meta.category,
        });
        break;
      }

      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }

    // Extract structured brand context
    const context = extractBrandContext(meta, sourceType, additionalData);

    logger.info('Brand context extracted successfully', {
      brandVoice: context.brandVoice,
      targetAudience: context.targetAudience,
      keyMessagesCount: context.keyMessages.length,
    });

    return {
      ...context,
      logoUrl,
      brandSettings,
    };
  } catch (error) {
    logger.error('Brand scraping failed', {
      sourceUrl,
      sourceType,
      error: error instanceof Error ? error.message : String(error),
    });

    // Re-throw with more context
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError(
      `Failed to scrape brand from ${sourceType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      'BRAND_SCRAPING_FAILED'
    );
  }
}

