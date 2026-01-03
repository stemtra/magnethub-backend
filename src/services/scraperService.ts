import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

interface ScrapedContent {
  title: string;
  metaDescription: string;
  headings: string[];
  paragraphs: string[];
  listItems: string[];
  links: { text: string; href: string }[];
  fullText: string;
}

// Brand extraction types
export interface ExtractedBrand {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  theme: 'light' | 'dark';
  logoUrl?: string;
}

// Default brand settings (neutral light theme)
const DEFAULT_BRAND: ExtractedBrand = {
  primaryColor: '#1F1F1F',
  accentColor: '#3B82F6',
  backgroundColor: '#FFFFFF',
  textColor: '#1F1F1F',
  fontFamily: 'Inter',
  theme: 'light',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch and parse website content
 */
export async function scrapeWebsite(url: string): Promise<ScrapedContent> {
  try {
    logger.info('Scraping website', { url });

    // Validate URL
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw AppError.badRequest('Invalid URL protocol. Use http or https.');
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      throw AppError.badRequest(`Failed to fetch website: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style, noscript, iframe, nav, footer, header').remove();

    // Extract content
    const title = $('title').text().trim() || $('h1').first().text().trim() || '';
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || 
                           $('meta[property="og:description"]').attr('content')?.trim() || '';

    const headings: string[] = [];
    $('h1, h2, h3, h4').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 200) {
        headings.push(text);
      }
    });

    const paragraphs: string[] = [];
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 30 && text.length < 2000) {
        paragraphs.push(text);
      }
    });

    const listItems: string[] = [];
    $('li').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10 && text.length < 500) {
        listItems.push(text);
      }
    });

    const links: { text: string; href: string }[] = [];
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (text && text.length > 2 && text.length < 100 && href) {
        links.push({ text, href });
      }
    });

    // Get main content text
    const mainContent = $('main, article, .content, .main, #content, #main, body');
    const fullText = mainContent
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 15000); // Limit to ~15k chars

    logger.info('Website scraped successfully', {
      url,
      titleLength: title.length,
      paragraphCount: paragraphs.length,
      headingCount: headings.length,
    });

    return {
      title,
      metaDescription,
      headings: headings.slice(0, 20), // Limit arrays
      paragraphs: paragraphs.slice(0, 30),
      listItems: listItems.slice(0, 30),
      links: links.slice(0, 20),
      fullText,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Failed to scrape website', { url, error });
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw AppError.badRequest('Website took too long to respond. Please try again.');
      }
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        throw AppError.badRequest('Website not found. Please check the URL.');
      }
    }

    throw AppError.badRequest('Failed to fetch website content. Please check the URL and try again.');
  }
}

/**
 * Create a summary of scraped content for the AI prompt
 */
export function formatScrapedContentForPrompt(content: ScrapedContent): string {
  const sections: string[] = [];

  if (content.title) {
    sections.push(`**Website Title:** ${content.title}`);
  }

  if (content.metaDescription) {
    sections.push(`**Description:** ${content.metaDescription}`);
  }

  if (content.headings.length > 0) {
    sections.push(`**Key Headings:**\n${content.headings.map(h => `- ${h}`).join('\n')}`);
  }

  if (content.paragraphs.length > 0) {
    sections.push(`**Main Content:**\n${content.paragraphs.slice(0, 10).join('\n\n')}`);
  }

  if (content.listItems.length > 0) {
    sections.push(`**Key Points:**\n${content.listItems.slice(0, 15).map(li => `- ${li}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

// ============================================
// Brand Extraction
// ============================================

/**
 * Extract brand colors, fonts, and theme from a website
 */
export async function extractBrandFromWebsite(url: string): Promise<ExtractedBrand> {
  try {
    logger.info('Extracting brand from website', { url });

    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return DEFAULT_BRAND;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return DEFAULT_BRAND;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract colors from various sources
    const colors = extractColors($, html);
    
    // Extract fonts
    const fontFamily = extractFontFamily($, html);
    
    // Extract logo
    const logoUrl = extractLogoUrl($, parsedUrl.origin);
    
    // Determine theme (light or dark) based on background color
    const theme = determineBrandTheme(colors.backgroundColor);

    const brand: ExtractedBrand = {
      primaryColor: colors.primaryColor,
      accentColor: colors.accentColor,
      backgroundColor: colors.backgroundColor,
      textColor: colors.textColor,
      fontFamily,
      theme,
      logoUrl,
    };

    logger.info('Brand extracted successfully', { url, brand });
    return brand;
  } catch (error) {
    logger.warn('Failed to extract brand, using defaults', { url, error });
    return DEFAULT_BRAND;
  }
}

/**
 * Extract colors from CSS, meta tags, and inline styles
 */
function extractColors($: cheerio.CheerioAPI, html: string): {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
} {
  const colorCounts: Record<string, number> = {};
  
  // 1. Check meta theme-color
  const themeColor = $('meta[name="theme-color"]').attr('content');
  if (themeColor && isValidColor(themeColor)) {
    colorCounts[normalizeColor(themeColor)] = (colorCounts[normalizeColor(themeColor)] || 0) + 10;
  }

  // 2. Extract CSS custom properties (--primary, --accent, --brand, etc.)
  const cssVarPatterns = [
    /--(?:primary|brand|main)(?:-color)?:\s*([^;}\s]+)/gi,
    /--(?:accent|secondary|cta)(?:-color)?:\s*([^;}\s]+)/gi,
    /--(?:bg|background)(?:-color)?:\s*([^;}\s]+)/gi,
  ];

  let primaryFromCss: string | null = null;
  let accentFromCss: string | null = null;
  let bgFromCss: string | null = null;

  for (const pattern of cssVarPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const color = match[1];
      if (color && isValidColor(color)) {
        if (pattern.source.includes('primary|brand|main')) {
          primaryFromCss = normalizeColor(color);
        } else if (pattern.source.includes('accent|secondary|cta')) {
          accentFromCss = normalizeColor(color);
        } else if (pattern.source.includes('bg|background')) {
          bgFromCss = normalizeColor(color);
        }
      }
    }
  }

  // 3. Extract colors from inline styles on key elements
  const buttonColors: string[] = [];
  $('button, a.btn, .button, [class*="cta"], [class*="primary"]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const bgMatch = style.match(/background(?:-color)?:\s*([^;]+)/i);
    if (bgMatch && isValidColor(bgMatch[1])) {
      buttonColors.push(normalizeColor(bgMatch[1]));
    }
    const classes = $(el).attr('class') || '';
    // Check for Tailwind/utility classes
    const tailwindBg = classes.match(/bg-\[([^\]]+)\]/);
    if (tailwindBg && isValidColor(tailwindBg[1])) {
      buttonColors.push(normalizeColor(tailwindBg[1]));
    }
  });

  // 4. Extract body/html background
  let bodyBg = $('body').css('background-color') || $('body').attr('style')?.match(/background(?:-color)?:\s*([^;]+)/i)?.[1];
  if (!bodyBg || !isValidColor(bodyBg)) {
    bodyBg = $('html').css('background-color');
  }

  // 5. Analyze common color patterns in the HTML
  const hexPattern = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  const hexMatches = html.match(hexPattern) || [];
  for (const hex of hexMatches.slice(0, 100)) { // Limit to first 100
    const normalized = normalizeColor(hex);
    if (normalized && !isNeutralColor(normalized)) {
      colorCounts[normalized] = (colorCounts[normalized] || 0) + 1;
    }
  }

  // Sort by frequency
  const sortedColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)
    .filter(c => !isNeutralColor(c));

  // Determine final colors
  const primaryColor = primaryFromCss || themeColor || sortedColors[0] || '#0C0C0C';
  const accentColor = accentFromCss || buttonColors[0] || sortedColors[1] || '#10B981';
  const backgroundColor = bgFromCss || (bodyBg && isValidColor(bodyBg) ? normalizeColor(bodyBg) : null) || '#FFFFFF';
  
  // Text color based on background luminance
  const textColor = isLightColor(backgroundColor) ? '#1A1A1A' : '#FAFAFA';

  return {
    primaryColor: primaryColor.toUpperCase(),
    accentColor: accentColor.toUpperCase(),
    backgroundColor: backgroundColor.toUpperCase(),
    textColor,
  };
}

/**
 * Extract primary font family from website
 */
function extractFontFamily($: cheerio.CheerioAPI, html: string): string {
  // 1. Check Google Fonts links
  const googleFontsLinks = $('link[href*="fonts.googleapis.com"]');
  if (googleFontsLinks.length > 0) {
    const href = googleFontsLinks.first().attr('href') || '';
    const familyMatch = href.match(/family=([^:&]+)/);
    if (familyMatch) {
      return familyMatch[1].replace(/\+/g, ' ').split(',')[0] || 'Inter';
    }
  }

  // 2. Check CSS font-family on body
  const bodyStyle = $('body').attr('style') || '';
  const fontMatch = bodyStyle.match(/font-family:\s*['"]?([^'",;]+)/i);
  if (fontMatch) {
    return cleanFontName(fontMatch[1]);
  }

  // 3. Check CSS custom properties
  const fontVarMatch = html.match(/--(?:font|typography)(?:-family)?(?:-(?:primary|main|body))?:\s*['"]?([^'",;}\n]+)/i);
  if (fontVarMatch) {
    return cleanFontName(fontVarMatch[1]);
  }

  // 4. Look for @font-face declarations
  const fontFaceMatch = html.match(/@font-face[^}]*font-family:\s*['"]?([^'",;]+)/i);
  if (fontFaceMatch) {
    return cleanFontName(fontFaceMatch[1]);
  }

  return 'Inter'; // Default fallback
}

/**
 * Extract logo URL from website
 */
function extractLogoUrl($: cheerio.CheerioAPI, origin: string): string | undefined {
  // Priority order for logo detection
  const selectors = [
    'img[class*="logo"]',
    'img[id*="logo"]',
    'img[alt*="logo"]',
    'header img:first-child',
    'a[class*="logo"] img',
    '.logo img',
    '#logo img',
    'nav img:first-child',
  ];

  for (const selector of selectors) {
    const img = $(selector).first();
    const src = img.attr('src');
    if (src) {
      // Handle relative URLs
      if (src.startsWith('//')) {
        return `https:${src}`;
      } else if (src.startsWith('/')) {
        return `${origin}${src}`;
      } else if (src.startsWith('http')) {
        return src;
      }
      return `${origin}/${src}`;
    }
  }

  // Check for SVG logos in header
  const svgLogo = $('header svg, .logo svg, nav svg').first();
  if (svgLogo.length > 0) {
    // Can't easily extract SVG as URL, skip
    return undefined;
  }

  return undefined;
}

/**
 * Determine if the brand is light or dark themed
 */
function determineBrandTheme(backgroundColor: string): 'light' | 'dark' {
  return isLightColor(backgroundColor) ? 'light' : 'dark';
}

// ============================================
// Color Utility Functions
// ============================================

function isValidColor(color: string): boolean {
  if (!color) return false;
  const trimmed = color.trim().toLowerCase();
  
  // Check hex
  if (/^#(?:[0-9a-f]{3}){1,2}$/i.test(trimmed)) return true;
  
  // Check rgb/rgba
  if (/^rgba?\([^)]+\)$/i.test(trimmed)) return true;
  
  // Check named colors (basic set)
  const namedColors = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey'];
  if (namedColors.includes(trimmed)) return true;
  
  return false;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  
  // Already hex
  if (trimmed.startsWith('#')) {
    // Expand 3-char hex to 6-char
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }
  
  // Named colors to hex
  const namedToHex: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#00ff00',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
    pink: '#ffc0cb',
    gray: '#808080',
    grey: '#808080',
  };
  if (namedToHex[trimmed]) {
    return namedToHex[trimmed];
  }
  
  // RGB to hex
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  
  return trimmed;
}

function isNeutralColor(hex: string): boolean {
  if (!hex.startsWith('#') || hex.length !== 7) return false;
  
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  // Check if it's a grayscale color (r, g, b are similar)
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (max - min) < 30; // Low saturation = neutral
}

function isLightColor(hex: string): boolean {
  if (!hex.startsWith('#')) return true; // Default to light
  
  const color = hex.length === 4 
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
    
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

function cleanFontName(font: string): string {
  return font
    .replace(/['"]/g, '')
    .replace(/\s*,.*$/, '') // Remove fallbacks
    .replace(/\s+/g, ' ')
    .trim();
}

