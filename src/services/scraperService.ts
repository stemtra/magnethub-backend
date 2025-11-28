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

