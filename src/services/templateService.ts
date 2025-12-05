import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import type { IBrandSettings, ILandingPageCopy, LandingPageTemplate } from '../types/index.js';

// @ts-ignore - import.meta.url is valid in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default brand settings
export const DEFAULT_BRAND_SETTINGS: IBrandSettings = {
  primaryColor: '#0C0C0C',
  accentColor: '#10B981',
  backgroundColor: '#0C0C0C',
  textColor: '#FAFAFA',
  fontFamily: 'Plus Jakarta Sans',
  theme: 'dark',
  landingPageTemplate: 'minimal',
};

// ============================================
// Template Variables
// ============================================

interface TemplateVariables {
  // Brand
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  textMuted: string;
  surfaceColor: string;
  borderColor: string;
  fontFamily: string;
  fontFamilyEncoded: string;
  accentGlow: string;
  buttonTextColor: string;
  logoUrl?: string;
  
  // Content
  title: string;
  description: string;
  headline: string;
  subheadline: string;
  benefits: string[];
  cta: string;
  formTitle: string;
  formSubtitle: string;
  formAction: string;
}

// ============================================
// Color Utilities
// ============================================

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function adjustColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const adjust = (value: number) => {
    const adjusted = value + amount;
    return Math.max(0, Math.min(255, adjusted));
  };
  
  const r = adjust(rgb.r).toString(16).padStart(2, '0');
  const g = adjust(rgb.g).toString(16).padStart(2, '0');
  const b = adjust(rgb.b).toString(16).padStart(2, '0');
  
  return `#${r}${g}${b}`;
}

function getContrastColor(hex: string): string {
  return getLuminance(hex) > 0.5 ? '#1A1A1A' : '#FFFFFF';
}

function createGlowColor(accentHex: string): string {
  const rgb = hexToRgb(accentHex);
  if (!rgb) return 'rgba(16, 185, 129, 0.15)';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;
}

// ============================================
// Template Rendering
// ============================================

// Cache for all templates
const templateCache: Map<LandingPageTemplate, string> = new Map();

// Template file mapping
const templateFiles: Record<LandingPageTemplate, string> = {
  minimal: 'landing-page-minimal.html',
  bold: 'landing-page-bold.html',
  split: 'landing-page-split.html',
  classic: 'landing-page-classic.html',
};

async function loadTemplate(template: LandingPageTemplate = 'minimal'): Promise<string> {
  // Check cache first
  const cached = templateCache.get(template);
  if (cached) {
    return cached;
  }
  
  // Load template file
  const filename = templateFiles[template] || templateFiles.minimal;
  const templatePath = join(__dirname, '../templates', filename);
  
  try {
    const content = await readFile(templatePath, 'utf-8');
    templateCache.set(template, content);
    return content;
  } catch (error) {
    // Fallback to minimal if template not found
    logger.warn(`Template ${template} not found, falling back to minimal`);
    const fallbackPath = join(__dirname, '../templates', templateFiles.minimal);
    const fallback = await readFile(fallbackPath, 'utf-8');
    templateCache.set('minimal', fallback);
    return fallback;
  }
}

/**
 * Build template variables from brand settings and landing page copy
 */
function buildVariables(
  brand: IBrandSettings,
  copy: ILandingPageCopy,
  formAction: string
): TemplateVariables {
  const isDark = brand.theme === 'dark' || getLuminance(brand.backgroundColor) < 0.5;
  
  // Calculate derived colors based on theme
  const textMuted = isDark
    ? 'rgba(255, 255, 255, 0.6)'
    : 'rgba(0, 0, 0, 0.55)';
    
  const surfaceColor = isDark
    ? adjustColor(brand.backgroundColor, 15)
    : adjustColor(brand.backgroundColor, -8);
    
  const borderColor = isDark
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(0, 0, 0, 0.08)';
  
  return {
    // Brand colors
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    backgroundColor: brand.backgroundColor,
    textColor: brand.textColor,
    textMuted,
    surfaceColor,
    borderColor,
    fontFamily: brand.fontFamily,
    fontFamilyEncoded: encodeURIComponent(brand.fontFamily.replace(/ /g, '+')),
    accentGlow: createGlowColor(brand.accentColor),
    buttonTextColor: getContrastColor(brand.accentColor),
    logoUrl: brand.logoUrl,
    
    // Content
    title: copy.headline,
    description: copy.short_description,
    headline: copy.headline,
    subheadline: copy.subheadline,
    benefits: copy.benefit_bullets,
    cta: copy.cta,
    formTitle: 'Get your free copy',
    formSubtitle: 'Enter your email and we\'ll send it right over.',
    formAction,
  };
}

/**
 * Simple template engine - replaces {{variable}} patterns
 */
function renderTemplate(template: string, variables: TemplateVariables): string {
  let result = template;
  
  // Handle conditionals: {{#if variable}}content{{else}}altContent{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_, varName, ifContent, elseContent = '') => {
      const value = variables[varName as keyof TemplateVariables];
      return value ? ifContent : elseContent;
    }
  );
  
  // Handle each loops: {{#each benefits}}...{{this}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, arrayName, itemTemplate) => {
      const array = variables[arrayName as keyof TemplateVariables];
      if (!Array.isArray(array)) return '';
      
      return array
        .map((item) => itemTemplate.replace(/\{\{this\}\}/g, escapeHtml(String(item))))
        .join('');
    }
  );
  
  // Replace simple variables: {{variableName}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
    const value = variables[varName as keyof TemplateVariables];
    if (value === undefined) return '';
    if (typeof value === 'string') return escapeHtml(value);
    return String(value);
  });
  
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// Main Export
// ============================================

/**
 * Render a landing page with brand settings and copy
 */
export async function renderLandingPage(
  brand: IBrandSettings | undefined,
  copy: ILandingPageCopy,
  formAction: string
): Promise<string> {
  try {
    const effectiveBrand = brand || DEFAULT_BRAND_SETTINGS;
    const templateName = effectiveBrand.landingPageTemplate || 'minimal';
    const template = await loadTemplate(templateName);
    const variables = buildVariables(effectiveBrand, copy, formAction);
    const html = renderTemplate(template, variables);
    
    logger.debug('Landing page rendered', { formAction, template: templateName });
    return html;
  } catch (error) {
    logger.error('Failed to render landing page template', error);
    throw error;
  }
}

/**
 * Clear template cache (useful for development)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}

