import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { IYouTubeChannel, IYouTubeVideo } from '../types/index.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============================================
// URL Parsing & Validation
// ============================================

/**
 * Detect if a URL is a YouTube channel URL
 */
export function isYouTubeUrl(url: string): boolean {
  const youtubePatterns = [
    /^https?:\/\/(www\.)?youtube\.com\/@[\w.-]+\/?$/i,
    /^https?:\/\/(www\.)?youtube\.com\/channel\/[\w-]+\/?$/i,
    /^https?:\/\/(www\.)?youtube\.com\/c\/[\w.-]+\/?$/i,
    /^https?:\/\/(www\.)?youtube\.com\/user\/[\w.-]+\/?$/i,
  ];

  const trimmed = url.trim();
  return youtubePatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Extract channel identifier from YouTube URL or handle
 */
export function extractYouTubeHandle(input: string): { type: 'handle' | 'channel' | 'c' | 'user'; value: string } | null {
  const trimmed = input.trim();

  // Handle @username format
  const handleMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/i) || 
                      trimmed.match(/^@([\w.-]+)$/);
  if (handleMatch && handleMatch[1]) {
    return { type: 'handle', value: handleMatch[1] };
  }

  // Channel ID format
  const channelMatch = trimmed.match(/youtube\.com\/channel\/([\w-]+)/i);
  if (channelMatch && channelMatch[1]) {
    return { type: 'channel', value: channelMatch[1] };
  }

  // Custom URL format (/c/)
  const customMatch = trimmed.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (customMatch && customMatch[1]) {
    return { type: 'c', value: customMatch[1] };
  }

  // Legacy user format
  const userMatch = trimmed.match(/youtube\.com\/user\/([\w.-]+)/i);
  if (userMatch && userMatch[1]) {
    return { type: 'user', value: userMatch[1] };
  }

  return null;
}

/**
 * Normalize YouTube input to a canonical channel URL
 */
export function normalizeYouTubeUrl(input: string): string {
  const trimmed = input.trim();
  
  // Already a full URL
  if (trimmed.startsWith('http')) {
    return trimmed;
  }

  // @handle format
  if (trimmed.startsWith('@')) {
    return `https://www.youtube.com/${trimmed}`;
  }

  // Assume it's a handle without @
  return `https://www.youtube.com/@${trimmed}`;
}

// ============================================
// YouTube Channel Scraping
// ============================================

/**
 * Scrape a YouTube channel for public data
 */
export async function scrapeYouTubeChannel(input: string): Promise<IYouTubeChannel> {
  const channelUrl = normalizeYouTubeUrl(input);
  const extracted = extractYouTubeHandle(channelUrl);

  logger.info('Scraping YouTube channel', { input, channelUrl, extracted });

  try {
    const channel = await scrapeChannelPage(channelUrl);
    
    logger.info('YouTube channel scraped successfully', {
      name: channel.name,
      subscribers: channel.subscriberCount,
      videos: channel.videoCount,
    });

    return channel;
  } catch (error) {
    logger.error('Failed to scrape YouTube channel', { input, error });
    
    if (error instanceof AppError) {
      throw error;
    }

    throw AppError.badRequest(
      'Unable to fetch YouTube channel. Please check the URL and try again.'
    );
  }
}

/**
 * Scrape channel data from YouTube page
 */
async function scrapeChannelPage(channelUrl: string): Promise<IYouTubeChannel> {
  // Fetch the channel About page for full description
  const aboutUrl = channelUrl.replace(/\/?$/, '/about');
  
  const response = await fetch(aboutUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw AppError.badRequest('YouTube channel not found.');
    }
    throw AppError.badRequest(`Failed to fetch YouTube channel: ${response.status}`);
  }

  const html = await response.text();
  
  // Parse the channel data from the page
  let channel = parseChannelFromHtml(html, channelUrl);
  
  // If no description found, try extracting from About page content
  if (channel && !channel.description) {
    const aboutDescription = extractAboutDescription(html);
    if (aboutDescription) {
      channel.description = aboutDescription;
    }
  }
  
  if (!channel) {
    throw AppError.badRequest(
      'Could not parse YouTube channel. The channel may not exist or YouTube may have changed their page structure.'
    );
  }

  return channel;
}

/**
 * Extract description from YouTube About page
 */
function extractAboutDescription(html: string): string | null {
  // Try to find description in aboutChannelRenderer
  const aboutMatch = html.match(/"description":\s*\{"simpleText":\s*"([^"]+)"/);
  if (aboutMatch && aboutMatch[1]) {
    return decodeYouTubeString(aboutMatch[1]);
  }
  
  // Try channelAboutFullMetadataRenderer
  const fullMetaMatch = html.match(/"channelAboutFullMetadataRenderer":\s*\{[^}]*"description":\s*\{"simpleText":\s*"([^"]+)"/);
  if (fullMetaMatch && fullMetaMatch[1]) {
    return decodeYouTubeString(fullMetaMatch[1]);
  }
  
  return null;
}

/**
 * Decode YouTube's escaped string format
 */
function decodeYouTubeString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u0026/g, '&');
}

/**
 * Parse channel data from YouTube HTML
 * YouTube embeds JSON data in the page that we can extract
 */
function parseChannelFromHtml(html: string, channelUrl: string): IYouTubeChannel | null {
  // Try to extract ytInitialData JSON
  const initialDataMatch = html.match(/var ytInitialData = ({.+?});<\/script>/s) ||
                           html.match(/window\["ytInitialData"\] = ({.+?});/s);
  
  let channelData: IYouTubeChannel | null = null;

  if (initialDataMatch && initialDataMatch[1]) {
    try {
      const data = JSON.parse(initialDataMatch[1]);
      channelData = parseYtInitialData(data);
    } catch {
      // JSON parse failed, try fallback
    }
  }

  // Fallback: Parse from meta tags
  if (!channelData) {
    channelData = parseFromMetaTags(html, channelUrl);
  }

  return channelData;
}

/**
 * Parse channel data from ytInitialData JSON
 */
function parseYtInitialData(data: Record<string, unknown>): IYouTubeChannel | null {
  try {
    // Navigate through the data structure to find channel info
    const metadata = findNestedValue(data, 'channelMetadataRenderer') as Record<string, unknown> | null;
    const header = findNestedValue(data, 'c4TabbedHeaderRenderer') as Record<string, unknown> | null;
    
    if (!metadata && !header) {
      return null;
    }

    const channelId = (metadata?.externalId as string) || '';
    const name = (metadata?.title as string) || (header?.title as string) || '';
    const description = (metadata?.description as string) || '';
    
    // Extract subscriber count
    let subscriberCount = 0;
    const subscriberText = (header?.subscriberCountText as { simpleText?: string })?.simpleText || '';
    subscriberCount = parseCount(subscriberText);

    // Extract video count from tabs
    let videoCount = 0;
    const tabs = findNestedValue(data, 'tabs') as Array<Record<string, unknown>> | null;
    if (tabs) {
      for (const tab of tabs) {
        const tabRenderer = tab.tabRenderer as Record<string, unknown> | undefined;
        if (tabRenderer?.title === 'Videos') {
          const content = tabRenderer.content as Record<string, unknown> | undefined;
          const richGrid = content?.richGridRenderer as Record<string, unknown> | undefined;
          const contents = richGrid?.contents as Array<unknown> | undefined;
          videoCount = contents?.length || 0;
        }
      }
    }

    // Extract thumbnail
    const avatar = header?.avatar as { thumbnails?: Array<{ url: string }> } | undefined;
    const thumbnailUrl = avatar?.thumbnails?.[avatar.thumbnails.length - 1]?.url;

    // Extract banner
    const banner = header?.banner as { thumbnails?: Array<{ url: string }> } | undefined;
    const bannerUrl = banner?.thumbnails?.[banner.thumbnails.length - 1]?.url;

    // Extract recent videos
    const recentVideos: IYouTubeVideo[] = [];
    const videoContents = findNestedValue(data, 'contents') as Array<Record<string, unknown>> | null;
    if (videoContents) {
      for (const item of videoContents.slice(0, 10)) {
        const videoRenderer = (item as Record<string, unknown>).richItemRenderer as Record<string, unknown> | undefined;
        const video = videoRenderer?.content as Record<string, unknown> | undefined;
        const vr = video?.videoRenderer as Record<string, unknown> | undefined;
        if (vr) {
          recentVideos.push({
            title: ((vr.title as { runs?: Array<{ text: string }> })?.runs?.[0]?.text) || '',
            description: ((vr.descriptionSnippet as { runs?: Array<{ text: string }> })?.runs?.[0]?.text) || '',
            viewCount: parseCount((vr.viewCountText as { simpleText?: string })?.simpleText || ''),
            likeCount: 0,
          });
        }
      }
    }

    // Check verification badge
    const badges = header?.badges as Array<{ metadataBadgeRenderer?: { style?: string } }> | undefined;
    const isVerified = badges?.some(b => 
      b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED' ||
      b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST'
    ) || false;

    // Extract handle
    const vanityUrl = metadata?.vanityChannelUrl as string | undefined;
    const handle = vanityUrl?.replace('http://www.youtube.com/', '').replace('https://www.youtube.com/', '');

    return {
      channelId,
      handle,
      name,
      description,
      subscriberCount,
      videoCount,
      viewCount: 0, // Not easily available from this data
      thumbnailUrl,
      bannerUrl,
      isVerified,
      recentVideos,
    };
  } catch (error) {
    logger.warn('Failed to parse ytInitialData', { error });
    return null;
  }
}

/**
 * Fallback: Parse from meta tags
 */
function parseFromMetaTags(html: string, channelUrl: string): IYouTubeChannel | null {
  // Extract basic info from meta tags
  const nameMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i) ||
                    html.match(/content="([^"]+)"\s+(?:property|name)="og:title"/i);
  
  const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i) ||
                    html.match(/content="([^"]+)"\s+(?:property|name)="og:description"/i);

  const imageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i) ||
                     html.match(/content="([^"]+)"\s+(?:property|name)="og:image"/i);

  // Try to extract subscriber count from description or page content
  const subMatch = html.match(/([\d,.]+[KMB]?)\s*subscribers?/i);
  const videoMatch = html.match(/([\d,.]+)\s*videos?/i);

  const name = nameMatch?.[1]?.replace(' - YouTube', '').trim() || '';
  const description = descMatch?.[1] || '';
  
  if (!name) {
    return null;
  }

  // Extract handle from URL
  const handleMatch = channelUrl.match(/@([\w.-]+)/);
  const handle = handleMatch ? `@${handleMatch[1]}` : undefined;

  return {
    channelId: '',
    handle,
    name,
    description,
    subscriberCount: subMatch ? parseCount(subMatch[1]) : 0,
    videoCount: videoMatch ? parseInt(videoMatch[1].replace(/,/g, ''), 10) : 0,
    viewCount: 0,
    thumbnailUrl: imageMatch?.[1],
    isVerified: html.includes('BADGE_STYLE_TYPE_VERIFIED'),
    recentVideos: [],
  };
}

/**
 * Helper to find nested value in object
 */
function findNestedValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return null;
  
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  
  for (const k in record) {
    const result = findNestedValue(record[k], key);
    if (result) return result;
  }
  
  return null;
}

/**
 * Parse count strings like "1.2K", "3.5M", "1,234 subscribers"
 */
function parseCount(countStr: string): number {
  if (!countStr) return 0;
  
  const cleaned = countStr.replace(/,/g, '').replace(/subscribers?/i, '').trim().toUpperCase();
  const multipliers: Record<string, number> = {
    'K': 1000,
    'M': 1000000,
    'B': 1000000000,
  };

  const match = cleaned.match(/^([\d.]+)([KMB])?$/);
  if (match) {
    const num = parseFloat(match[1]);
    const multiplier = match[2] ? multipliers[match[2]] || 1 : 1;
    return Math.round(num * multiplier);
  }

  return parseInt(cleaned, 10) || 0;
}

// ============================================
// Format YouTube Data for AI Pipeline
// ============================================

/**
 * Format YouTube channel data for the AI prompt
 */
export function formatYouTubeChannelForPrompt(channel: IYouTubeChannel): string {
  const sections: string[] = [];

  sections.push(`**YouTube Channel:** ${channel.name}`);
  
  if (channel.handle) {
    sections.push(`**Handle:** ${channel.handle}`);
  }

  sections.push(`**Stats:** ${formatNumber(channel.subscriberCount)} subscribers · ${formatNumber(channel.videoCount)} videos`);

  if (channel.isVerified) {
    sections.push(`**Verified Channel:** Yes ✓`);
  }

  if (channel.description) {
    sections.push(`**About:**\n${channel.description}`);
  }

  if (channel.recentVideos.length > 0) {
    const videoTitles = channel.recentVideos
      .slice(0, 10)
      .map((video, i) => `${i + 1}. "${video.title}" (${formatNumber(video.viewCount)} views)`)
      .join('\n');

    sections.push(`**Recent Videos:**\n${videoTitles}`);

    // Calculate average views
    const avgViews = channel.recentVideos.reduce((sum, v) => sum + v.viewCount, 0) / channel.recentVideos.length;
    sections.push(`**Avg. Views per Video:** ${formatNumber(Math.round(avgViews))}`);
  }

  return sections.join('\n\n');
}

/**
 * Format large numbers (1000 → 1K, 1000000 → 1M)
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

