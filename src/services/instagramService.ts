import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { IInstagramProfile, IInstagramPost } from '../types/index.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ============================================
// URL Parsing & Validation
// ============================================

/**
 * Detect if a URL is an Instagram profile URL
 */
export function isInstagramUrl(url: string): boolean {
  const instagramPatterns = [
    /^https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?$/i,
    /^https?:\/\/(www\.)?instagr\.am\/([a-zA-Z0-9._]+)\/?$/i,
    /^@?([a-zA-Z0-9._]+)$/i, // Just username with optional @
  ];

  const trimmed = url.trim();
  return instagramPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Extract username from Instagram URL or handle
 */
export function extractUsername(input: string): string {
  const trimmed = input.trim();

  // Handle full URLs
  const urlMatch = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/i) ||
                   trimmed.match(/instagr\.am\/([a-zA-Z0-9._]+)/i);
  if (urlMatch) {
    return urlMatch[1]!;
  }

  // Handle @username format
  if (trimmed.startsWith('@')) {
    return trimmed.slice(1);
  }

  // Assume it's just a username
  return trimmed;
}

/**
 * Normalize Instagram input to a full profile URL
 */
export function normalizeInstagramUrl(input: string): string {
  const username = extractUsername(input);
  return `https://www.instagram.com/${username}/`;
}

// ============================================
// Instagram Profile Scraping
// ============================================

/**
 * Scrape an Instagram profile for public data
 * Uses Instagram's web interface to extract profile information
 */
export async function scrapeInstagramProfile(input: string): Promise<IInstagramProfile> {
  const username = extractUsername(input);
  const profileUrl = normalizeInstagramUrl(input);

  logger.info('Scraping Instagram profile', { username, profileUrl });

  try {
    // Try the web profile approach
    const profile = await scrapeWebProfile(username, profileUrl);
    
    logger.info('Instagram profile scraped successfully', {
      username: profile.username,
      followers: profile.followerCount,
      postsCount: profile.postsCount,
      bioLength: profile.bio.length,
      capturedPosts: profile.recentPosts.length,
    });

    return profile;
  } catch (error) {
    logger.error('Failed to scrape Instagram profile', { username, error });
    
    if (error instanceof AppError) {
      throw error;
    }

    throw AppError.badRequest(
      'Unable to fetch Instagram profile. Please check the username and try again.'
    );
  }
}

/**
 * Scrape profile data from Instagram web page
 */
async function scrapeWebProfile(username: string, profileUrl: string): Promise<IInstagramProfile> {
  // Fetch the profile page
  const response = await fetch(profileUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw AppError.badRequest(`Instagram profile @${username} not found.`);
    }
    throw AppError.badRequest(`Failed to fetch Instagram profile: ${response.status}`);
  }

  const html = await response.text();

  // Try to extract data from the page
  const profile = extractProfileFromHtml(html, username);

  if (!profile) {
    throw AppError.badRequest(
      'Could not parse Instagram profile. The profile may be private or Instagram may have changed their page structure.'
    );
  }

  return profile;
}

/**
 * Extract profile data from Instagram HTML
 * Instagram embeds profile data in various ways - we try multiple extraction methods
 */
function extractProfileFromHtml(html: string, username: string): IInstagramProfile | null {
  // Method 1: Try to find the SharedData script (older method but sometimes works)
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
  if (sharedDataMatch) {
    try {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const userData = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (userData) {
        return parseGraphqlUser(userData);
      }
    } catch {
      // Continue to next method
    }
  }

  // Method 2: Try to find additional data scripts
  const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\);/);
  if (additionalDataMatch) {
    try {
      const data = JSON.parse(additionalDataMatch[1]);
      const userData = data?.graphql?.user || data?.data?.user;
      if (userData) {
        return parseGraphqlUser(userData);
      }
    } catch {
      // Continue to next method
    }
  }

  // Method 3: Parse meta tags and visible content as fallback
  return parseFromMetaTags(html, username);
}

/**
 * Parse user data from Instagram's GraphQL response format
 */
function parseGraphqlUser(user: Record<string, unknown>): IInstagramProfile {
  const recentPosts: IInstagramPost[] = [];
  
  // Extract recent posts from edge_owner_to_timeline_media
  const timelineMedia = user.edge_owner_to_timeline_media as { edges?: Array<{ node: Record<string, unknown> }> } | undefined;
  if (timelineMedia?.edges) {
    for (const edge of timelineMedia.edges.slice(0, 12)) {
      const node = edge.node;
      const captionEdges = (node.edge_media_to_caption as { edges?: Array<{ node: { text: string } }> })?.edges;
      recentPosts.push({
        caption: captionEdges?.[0]?.node?.text || '',
        likes: (node.edge_liked_by as { count?: number })?.count || 0,
        comments: (node.edge_media_to_comment as { count?: number })?.count || 0,
        isVideo: node.is_video === true,
        timestamp: node.taken_at_timestamp ? new Date((node.taken_at_timestamp as number) * 1000).toISOString() : undefined,
      });
    }
  }

  return {
    username: user.username as string || '',
    fullName: user.full_name as string || '',
    bio: user.biography as string || '',
    followerCount: (user.edge_followed_by as { count?: number })?.count || 0,
    followingCount: (user.edge_follow as { count?: number })?.count || 0,
    postsCount: (user.edge_owner_to_timeline_media as { count?: number })?.count || 0,
    profilePicUrl: user.profile_pic_url_hd as string || user.profile_pic_url as string || undefined,
    isVerified: user.is_verified === true,
    recentPosts,
  };
}

/**
 * Fallback: Parse basic info from meta tags when GraphQL data isn't available
 */
function parseFromMetaTags(html: string, username: string): IInstagramProfile | null {
  // Extract from og:description meta tag
  // Format: "X Followers, X Following, X Posts - See Instagram photos and videos from Name (@username)"
  const ogDescMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i) ||
                      html.match(/content="([^"]+)"\s+(?:property|name)="og:description"/i);
  
  const ogTitleMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/content="([^"]+)"\s+(?:property|name)="og:title"/i);

  // Try to parse description meta tag for bio
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
                    html.match(/content="([^"]+)"\s+name="description"/i);

  // Profile picture is often exposed via og:image / twitter:image even when GraphQL JSON is blocked.
  const ogImageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i) ||
                       html.match(/content="([^"]+)"\s+(?:property|name)="og:image"/i);
  const twitterImageMatch = html.match(/<meta\s+(?:property|name)="twitter:image"\s+content="([^"]+)"/i) ||
                            html.match(/content="([^"]+)"\s+(?:property|name)="twitter:image"/i);

  let followers = 0;
  let following = 0;
  let posts = 0;
  let fullName = '';
  let bio = '';
  let profilePicUrl: string | undefined;

  const decodeMetaUrl = (url: string): string =>
    url
      .trim()
      // minimal HTML entity decoding for common cases
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

  const candidateImage = ogImageMatch?.[1] || twitterImageMatch?.[1];
  if (candidateImage) {
    profilePicUrl = decodeMetaUrl(candidateImage);
  }

  // Parse og:description for counts
  if (ogDescMatch) {
    const desc = ogDescMatch[1];
    
    // Try to extract follower/following/posts counts
    const countsMatch = desc.match(/([\d,.]+[KMB]?)\s*Followers?,?\s*([\d,.]+[KMB]?)\s*Following,?\s*([\d,.]+[KMB]?)\s*Posts?/i);
    if (countsMatch) {
      followers = parseCount(countsMatch[1]);
      following = parseCount(countsMatch[2]);
      posts = parseCount(countsMatch[3]);
    }

    // Extract name from "from Name (@username)" pattern
    const nameMatch = desc.match(/from\s+(.+?)\s*\(@/i);
    if (nameMatch) {
      fullName = nameMatch[1].trim();
    }
  }

  // Parse og:title for name
  if (ogTitleMatch && !fullName) {
    // Format: "Name (@username) • Instagram photos and videos"
    const titleMatch = ogTitleMatch[1].match(/^(.+?)\s*\(@/);
    if (titleMatch) {
      fullName = titleMatch[1].trim();
    }
  }

  // Get bio from description if available
  if (descMatch) {
    const desc = descMatch[1];
    // Bio is often after the stats, look for it
    const bioMatch = desc.match(/Posts?\s*[-–,]\s*(.+)/i);
    if (bioMatch) {
      bio = bioMatch[1].replace(/See Instagram photos and videos.*$/i, '').trim();
    }
  }

  // Try to extract bio from page content if not found
  if (!bio) {
    // Look for the bio in a meta tag or content
    const bioContentMatch = html.match(/"biography"\s*:\s*"([^"]+)"/);
    if (bioContentMatch) {
      bio = bioContentMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\u[\dA-Fa-f]{4}/g, (match) => {
          return String.fromCharCode(parseInt(match.slice(2), 16));
        });
    }
  }

  // If we couldn't extract meaningful data, return null
  if (!fullName && !bio && followers === 0) {
    return null;
  }

  return {
    username,
    fullName: fullName || username,
    bio,
    followerCount: followers,
    followingCount: following,
    postsCount: posts,
    profilePicUrl,
    isVerified: html.includes('"is_verified":true') || html.includes('"verified":true'),
    recentPosts: [], // Can't reliably extract posts from meta tags
  };
}

/**
 * Parse count strings like "1.2K", "3.5M", "1,234"
 */
function parseCount(countStr: string): number {
  if (!countStr) return 0;
  
  const cleaned = countStr.replace(/,/g, '').trim().toUpperCase();
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
// Format Instagram Data for AI Pipeline
// ============================================

/**
 * Format Instagram profile data for the AI prompt
 * Similar to formatScrapedContentForPrompt but for Instagram
 */
export function formatInstagramProfileForPrompt(profile: IInstagramProfile): string {
  const sections: string[] = [];

  sections.push(`**Instagram Profile:** @${profile.username}`);
  
  if (profile.fullName && profile.fullName !== profile.username) {
    sections.push(`**Name:** ${profile.fullName}`);
  }

  sections.push(`**Stats:** ${formatNumber(profile.followerCount)} followers · ${formatNumber(profile.postsCount)} posts`);

  if (profile.isVerified) {
    sections.push(`**Verified Account:** Yes ✓`);
  }

  if (profile.bio) {
    sections.push(`**Bio:**\n${profile.bio}`);
  }

  if (profile.recentPosts.length > 0) {
    const postCaptions = profile.recentPosts
      .filter(post => post.caption && post.caption.length > 20)
      .slice(0, 10)
      .map((post, i) => `Post ${i + 1} (${formatNumber(post.likes)} likes):\n"${truncate(post.caption, 500)}"`)
      .join('\n\n');

    if (postCaptions) {
      sections.push(`**Recent Post Captions:**\n${postCaptions}`);
    }

    // Extract common hashtags
    const hashtags = extractCommonHashtags(profile.recentPosts);
    if (hashtags.length > 0) {
      sections.push(`**Common Hashtags:** ${hashtags.join(', ')}`);
    }

    // Calculate average engagement
    const avgLikes = profile.recentPosts.reduce((sum, p) => sum + p.likes, 0) / profile.recentPosts.length;
    const avgComments = profile.recentPosts.reduce((sum, p) => sum + p.comments, 0) / profile.recentPosts.length;
    sections.push(`**Avg. Engagement:** ${formatNumber(Math.round(avgLikes))} likes, ${formatNumber(Math.round(avgComments))} comments per post`);
  }

  return sections.join('\n\n');
}

/**
 * Extract common hashtags from posts
 */
function extractCommonHashtags(posts: IInstagramPost[]): string[] {
  const hashtagCounts: Record<string, number> = {};

  for (const post of posts) {
    const hashtags = post.caption.match(/#\w+/g) || [];
    for (const tag of hashtags) {
      const normalized = tag.toLowerCase();
      hashtagCounts[normalized] = (hashtagCounts[normalized] || 0) + 1;
    }
  }

  // Return top 10 most used hashtags
  return Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);
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

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

