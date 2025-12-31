import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import type { ILeadMagnetContent, LeadMagnetType, IBrandSettings } from '../types/index.js';

// ============================================
// Color Utilities
// ============================================

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result || !result[1] || !result[2] || !result[3]) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const { r, g, b } = rgb;
  const values = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const rs = values[0] ?? 0;
  const gs = values[1] ?? 0;
  const bs = values[2] ?? 0;
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastColor(hex: string): string {
  return getLuminance(hex) > 0.5 ? '#1a1a1a' : '#ffffff';
}

function adjustColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const adjust = (value: number) => {
    const adjusted = Math.round(value + (percent > 0 ? (255 - value) : value) * (percent / 100));
    return Math.max(0, Math.min(255, adjusted));
  };
  
  const r = adjust(rgb.r);
  const g = adjust(rgb.g);
  const b = adjust(rgb.b);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0,0,0,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// ============================================
// HTML Template Generation
// ============================================

function generatePdfHtml(
  content: ILeadMagnetContent, 
  type: LeadMagnetType,
  brand: IBrandSettings,
  brandName?: string
): string {
  const typeLabels: Record<LeadMagnetType, string> = {
    guide: 'GUIDE',
    checklist: 'CHECKLIST',
    mistakes: 'COMMON MISTAKES',
    blueprint: 'BLUEPRINT',
    swipefile: 'SWIPE FILE',
    cheatsheet: 'CHEAT SHEET',
    casestudy: 'CASE STUDY',
    infographic: 'INFOGRAPHIC',
  };

  // Determine if we're in dark or light mode based on background
  const isDark = brand.theme === 'dark' || getLuminance(brand.backgroundColor) < 0.5;
  
  // Calculate derived colors
  const textMuted = isDark ? hexToRgba('#ffffff', 0.65) : hexToRgba('#000000', 0.55);
  const textLight = isDark ? hexToRgba('#ffffff', 0.45) : hexToRgba('#000000', 0.35);
  const borderColor = isDark ? hexToRgba('#ffffff', 0.12) : hexToRgba('#000000', 0.1);
  const surfaceColor = isDark ? adjustColor(brand.backgroundColor, 8) : adjustColor(brand.backgroundColor, -5);
  const badgeTextColor = getContrastColor(brand.accentColor);

  // Build font import URL
  const fontFamily = brand.fontFamily || 'Inter';
  const fontFamilyEncoded = encodeURIComponent(fontFamily.replace(/ /g, '+'));
  const fontUrl = `https://fonts.googleapis.com/css2?family=${fontFamilyEncoded}:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap`;

  const isCompactType = ['checklist', 'cheatsheet', 'mistakes', 'swipefile'].includes(type);
  const sectionsHtml = isCompactType
    ? content.sections
        .map((section, index) => renderFlowSection(section, index + 1, type))
        .join('')
    : content.sections
        .map((section, index) => renderSection(section, index + 1, type, index === content.sections.length - 1))
        .join('');

  // Logo HTML if available
  const logoHtml = brand.logoUrl 
    ? `<img src="${brand.logoUrl}" alt="Logo" class="cover-logo" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontUrl}" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --color-primary: ${brand.primaryColor};
      --color-accent: ${brand.accentColor};
      --color-background: ${brand.backgroundColor};
      --color-surface: ${surfaceColor};
      --color-text: ${brand.textColor};
      --color-text-muted: ${textMuted};
      --color-text-light: ${textLight};
      --color-border: ${borderColor};
      --color-badge-text: ${badgeTextColor};
      
      --font-body: '${fontFamily}', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-heading: 'Playfair Display', Georgia, serif;
    }

    @page {
      size: A4;
      margin: 0;
    }

    body {
      font-family: var(--font-body);
      font-size: 11pt;
      line-height: 1.6;
      color: var(--color-text);
      background: var(--color-background);
    }

    /* ================================
       COVER PAGE
    ================================ */
    .cover-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px;
      text-align: center;
      position: relative;
      background: ${isDark 
        ? `linear-gradient(180deg, ${brand.backgroundColor} 0%, ${surfaceColor} 100%)`
        : `linear-gradient(180deg, ${brand.backgroundColor} 0%, ${surfaceColor} 100%)`
      };
      page-break-after: always;
    }

    .cover-logo {
      max-width: 180px;
      max-height: 60px;
      object-fit: contain;
      margin-bottom: 50px;
    }

    .cover-badge {
      display: inline-block;
      padding: 10px 28px;
      background: var(--color-accent);
      border-radius: 50px;
      font-size: 10pt;
      font-weight: 600;
      letter-spacing: 2px;
      color: var(--color-badge-text);
      margin-bottom: 40px;
    }

    .cover-title {
      font-family: var(--font-heading);
      font-size: 38pt;
      font-weight: 700;
      color: var(--color-text);
      line-height: 1.2;
      margin-bottom: 24px;
      max-width: 480px;
    }

    .cover-subtitle {
      font-size: 13pt;
      color: var(--color-text-muted);
      max-width: 400px;
      line-height: 1.7;
      margin-bottom: 50px;
    }

    .cover-divider {
      width: 60px;
      height: 3px;
      background: var(--color-accent);
      border-radius: 2px;
    }

    .cover-footer {
      position: absolute;
      bottom: 50px;
      font-size: 9pt;
      color: var(--color-text-light);
      font-style: italic;
    }

    /* ================================
       CONTENT PAGES
    ================================ */
    .content-page {
      padding: 50px 60px;
      min-height: 100vh;
      background: var(--color-background);
      page-break-after: always;
      position: relative;
    }

    /* We intentionally break AFTER content so the CTA naturally starts on a fresh page.
       Avoid forcing a break BEFORE the CTA (double-break can create blank pages). */

    /* ================================
       COMPACT FLOW CONTENT
       (for checklist/cheatsheet/mistakes/swipefile)
    ================================ */
    .content-flow {
      padding: 46px 54px;
      background: var(--color-background);
      page-break-after: always;
    }

    /* Cheatsheet: maximize density (often 1-2 pages) */
    .content-flow.cheatsheet {
      padding: 38px 42px;
      font-size: 10pt;
      line-height: 1.45;
      column-count: 2;
      column-gap: 26px;
      column-fill: auto;
    }

    .content-flow.cheatsheet .content-section {
      margin-bottom: 22px;
    }

    .content-flow.cheatsheet .content-section-title {
      font-size: 14pt;
      margin-bottom: 10px;
      padding-bottom: 8px;
    }

    .content-flow.cheatsheet .paragraph {
      margin-bottom: 10px;
      text-align: left;
      hyphens: none;
    }

    .content-flow.cheatsheet .bullet-item,
    .content-flow.cheatsheet .checkbox-item,
    .content-flow.cheatsheet .numbered-item {
      margin-bottom: 8px;
    }

    .content-section {
      margin-bottom: 34px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .content-section:last-child {
      margin-bottom: 0;
    }

    .content-section-title {
      font-family: var(--font-heading);
      font-size: 18pt;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.3;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--color-border);
    }

    /* Section Header */
    .section-header {
      display: flex;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--color-border);
    }

    .section-number {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      background: var(--color-accent);
      color: var(--color-badge-text);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16pt;
    }

    .section-title {
      font-family: var(--font-heading);
      font-size: 22pt;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.3;
      flex: 1;
    }

    /* Content Elements */
    .section-content {
      font-size: 11pt;
      line-height: 1.75;
    }

    .section-content h3,
    .subheading {
      font-family: var(--font-body);
      font-size: 12pt;
      font-weight: 600;
      color: var(--color-text);
      margin-top: 28px;
      margin-bottom: 12px;
    }

    .section-content p,
    .paragraph {
      margin-bottom: 16px;
      text-align: justify;
      hyphens: auto;
    }

    /* Bullet Lists */
    .bullet-list {
      margin: 16px 0;
      padding-left: 0;
      list-style: none;
    }

    .bullet-item {
      position: relative;
      padding-left: 24px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .bullet-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      width: 7px;
      height: 7px;
      background: var(--color-accent);
      border-radius: 50%;
    }

    /* Checkbox Lists (for checklists) */
    .checkbox-list {
      margin: 16px 0;
      padding-left: 0;
      list-style: none;
    }

    .checkbox-item {
      position: relative;
      padding-left: 34px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }

    .checkbox-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 2px;
      width: 18px;
      height: 18px;
      border: 2px solid var(--color-accent);
      border-radius: 4px;
      background: transparent;
    }

    /* Numbered Lists */
    .numbered-list {
      margin: 16px 0;
      padding-left: 0;
      list-style: none;
      counter-reset: item;
    }

    .numbered-item {
      position: relative;
      padding-left: 32px;
      margin-bottom: 14px;
      page-break-inside: avoid;
      counter-increment: item;
    }

    .numbered-item::before {
      content: counter(item) ".";
      position: absolute;
      left: 0;
      font-weight: 600;
      color: var(--color-accent);
    }

    /* Page Numbers */
    .page-number {
      position: absolute;
      bottom: 30px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 9pt;
      color: var(--color-text-light);
    }

    /* ================================
       CTA PAGE
    ================================ */
    .cta-page {
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px;
      text-align: center;
      background: ${isDark 
        ? `linear-gradient(180deg, ${surfaceColor} 0%, ${brand.backgroundColor} 100%)`
        : `linear-gradient(180deg, ${surfaceColor} 0%, ${brand.backgroundColor} 100%)`
      };
    }

    .cta-logo {
      max-width: 120px;
      max-height: 40px;
      object-fit: contain;
      margin-bottom: 40px;
      opacity: 0.8;
    }

    .cta-divider {
      width: 40px;
      height: 3px;
      background: var(--color-accent);
      border-radius: 2px;
      margin-bottom: 40px;
    }

    .cta-title {
      font-family: var(--font-heading);
      font-size: 28pt;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 30px;
    }

    .cta-text {
      font-size: 12pt;
      color: var(--color-text-muted);
      max-width: 400px;
      line-height: 1.8;
      margin-bottom: 50px;
    }

    .cta-footer {
      font-size: 9pt;
      color: var(--color-text-light);
      font-style: italic;
    }

    /* ================================
       UTILITIES
    ================================ */
    .avoid-break {
      page-break-inside: avoid;
    }

    .break-before {
      page-break-before: always;
    }
  </style>
</head>
<body>
  <!-- COVER PAGE -->
  <div class="cover-page">
    ${logoHtml}
    <div class="cover-badge">${typeLabels[type]}</div>
    <h1 class="cover-title">${escapeHtml(content.title)}</h1>
    <p class="cover-subtitle">${escapeHtml(content.subtitle)}</p>
    <div class="cover-divider"></div>
    <div class="cover-footer">${brandName ? `By ${escapeHtml(brandName)}` : ''}</div>
  </div>

  <!-- CONTENT SECTIONS -->
  ${isCompactType ? `<div class="content-flow ${type === 'cheatsheet' ? 'cheatsheet' : ''}">${sectionsHtml}</div>` : sectionsHtml}

  <!-- CTA PAGE -->
  <div class="cta-page">
    ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="Logo" class="cta-logo" />` : '<div class="cta-divider"></div>'}
    <h2 class="cta-title">Ready to Take Action?</h2>
    <p class="cta-text">${escapeHtml(content.cta)}</p>
    <div class="cta-footer">Thank you for reading</div>
  </div>
</body>
</html>`;
}

function renderSection(
  section: { title: string; content: string },
  sectionNum: number,
  _type: LeadMagnetType,
  isLast: boolean
): string {
  const contentHtml = parseAndRenderContent(stripRedundantTitle(section.content, section.title), _type);

  return `
  <div class="content-page${isLast ? ' is-last' : ''}">
    <div class="section-header">
      <div class="section-number">${sectionNum}</div>
      <h2 class="section-title">${escapeHtml(section.title)}</h2>
    </div>
    <div class="section-content">
      ${contentHtml}
    </div>
    <div class="page-number">${sectionNum}</div>
  </div>`;
}

function renderFlowSection(
  section: { title: string; content: string },
  _sectionNum: number,
  type: LeadMagnetType
): string {
  const contentHtml = parseAndRenderContent(stripRedundantTitle(section.content, section.title), type);
  return `
  <section class="content-section">
    <h2 class="content-section-title">${escapeHtml(section.title)}</h2>
    <div class="section-content">
      ${contentHtml}
    </div>
  </section>`;
}

function stripRedundantTitle(content: string, title: string): string {
  // If the model includes the section title again as the first header line inside the content,
  // strip it so the PDF doesn't show the title twice.
  const lines = content.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return content;

  const first = lines[firstIdx]!.trim();
  const normalizedTitle = cleanText(title).toLowerCase();

  // Match markdown headers like "## Title" / "### Title"
  if (first.startsWith('## ') || first.startsWith('### ')) {
    const headerText = cleanText(first.replace(/^#{2,3}\s+/, '')).toLowerCase();
    if (headerText === normalizedTitle) {
      const next = lines.slice(firstIdx + 1);
      return next.join('\n').trimStart();
    }
  }

  // Match bold-only header like "**Title**"
  if (first.startsWith('**') && first.endsWith('**') && first.length < 200) {
    const headerText = cleanText(first.slice(2, -2)).toLowerCase();
    if (headerText === normalizedTitle) {
      const next = lines.slice(firstIdx + 1);
      return next.join('\n').trimStart();
    }
  }

  return content;
}

function parseAndRenderContent(content: string, type: LeadMagnetType): string {
  const lines = content.split('\n');
  let html = '';
  let currentList: { type: 'bullet' | 'checkbox' | 'numbered'; items: string[] } | null = null;

  const flushList = () => {
    if (!currentList) return;
    
    const listClass = currentList.type === 'checkbox' ? 'checkbox-list' : 
                      currentList.type === 'numbered' ? 'numbered-list' : 'bullet-list';
    const itemClass = currentList.type === 'checkbox' ? 'checkbox-item' : 
                      currentList.type === 'numbered' ? 'numbered-item' : 'bullet-item';
    
    html += `<ul class="${listClass}">`;
    for (const item of currentList.items) {
      html += `<li class="${itemClass}">${escapeHtml(cleanText(item))}</li>`;
    }
    html += '</ul>';
    currentList = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    // Check for headers
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
      flushList();
      const headerText = trimmed.replace(/^#{2,3}\s+/, '');
      html += `<h3 class="subheading">${escapeHtml(cleanText(headerText))}</h3>`;
      continue;
    }

    // Check for bold subheadings
    if (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length < 100) {
      flushList();
      const headerText = trimmed.slice(2, -2);
      html += `<h3 class="subheading">${escapeHtml(headerText)}</h3>`;
      continue;
    }

    // Check for bullet points
    if (trimmed.match(/^[-*•]\s+/)) {
      const itemContent = trimmed.replace(/^[-*•]\s+/, '');
      const listType = type === 'checklist' ? 'checkbox' : 'bullet';
      
      if (!currentList || currentList.type !== listType) {
        flushList();
        currentList = { type: listType, items: [] };
      }
      currentList.items.push(itemContent);
      continue;
    }

    // Check for numbered items
    if (trimmed.match(/^\d+[.)]\s+/)) {
      const itemContent = trimmed.replace(/^\d+[.)]\s+/, '');
      
      if (!currentList || currentList.type !== 'numbered') {
        flushList();
        currentList = { type: 'numbered', items: [] };
      }
      currentList.items.push(itemContent);
      continue;
    }

    // Regular paragraph
    flushList();
    html += `<p class="paragraph">${escapeHtml(cleanText(trimmed))}</p>`;
  }

  flushList();
  return html;
}

function cleanText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold
    .replace(/\*(.+?)\*/g, '$1')       // Italic
    .replace(/`(.+?)`/g, '$1')         // Code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// PDF Generation with Puppeteer
// ============================================

export async function generatePdf(
  content: ILeadMagnetContent,
  type: LeadMagnetType,
  brand?: IBrandSettings,
  brandName?: string
): Promise<Buffer> {
  logger.info('Generating branded PDF with Puppeteer', { title: content.title, type, brandName });

  // Default brand settings if none provided
  const defaultBrand: IBrandSettings = {
    primaryColor: '#8B7355',
    accentColor: '#9A7B4F',
    backgroundColor: '#FFFFFF',
    textColor: '#1a1a1a',
    fontFamily: 'Inter',
    theme: 'light',
  };

  const brandToUse = brand || defaultBrand;

  let browser = null;

  try {
    // Generate HTML with branding
    const html = generatePdfHtml(content, type, brandToUse, brandName);

    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Set content and wait for fonts to load
    await page.setContent(html, { 
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });

    // Small delay for fonts to fully render
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    logger.info('Branded PDF generated successfully', {
      title: content.title,
      sizeKB: Math.round(pdfBuffer.length / 1024),
      brand: {
        primaryColor: brandToUse.primaryColor,
        accentColor: brandToUse.accentColor,
        hasLogo: !!brandToUse.logoUrl,
      },
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    logger.error('PDF generation failed', error);
    throw AppError.internal('Failed to generate PDF. Please try again.');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
