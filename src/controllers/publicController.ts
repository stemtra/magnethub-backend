import type { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { PageView } from '../models/PageView.js';
import { sendDeliveryEmail } from '../services/emailService.js';
import { getSignedPdfUrl, getSignedImageUrl } from '../services/storageService.js';
import { renderLandingPage, DEFAULT_BRAND_SETTINGS } from '../services/templateService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { Brand } from '../models/Brand.js';
import type { ApiResponse, IEmail, ILandingPageCopy, ILeadMagnet, IBrandSettings } from '../types/index.js';

// ============================================
// Traffic Source Detection
// ============================================

interface SourceInfo {
  source: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
}

function detectSource(req: Request): SourceInfo {
  // Check UTM parameters first (explicit tracking)
  const utmSource = req.query.utm_source as string | undefined;
  const utmMedium = req.query.utm_medium as string | undefined;
  const utmCampaign = req.query.utm_campaign as string | undefined;
  
  const referrer = req.headers.referer || req.headers.referrer as string | undefined;
  
  if (utmSource) {
    return {
      source: utmSource.toLowerCase(),
      medium: utmMedium?.toLowerCase(),
      campaign: utmCampaign,
      referrer,
    };
  }
  
  // No referrer = direct traffic
  if (!referrer) {
    return { source: 'direct', referrer: undefined };
  }
  
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    
    // Match known sources
    if (host.includes('google')) return { source: 'google', medium: 'organic', referrer };
    if (host.includes('bing')) return { source: 'bing', medium: 'organic', referrer };
    if (host.includes('duckduckgo')) return { source: 'duckduckgo', medium: 'organic', referrer };
    if (host.includes('twitter') || host.includes('x.com') || host.includes('t.co')) {
      return { source: 'twitter', medium: 'social', referrer };
    }
    if (host.includes('facebook') || host.includes('fb.com')) {
      return { source: 'facebook', medium: 'social', referrer };
    }
    if (host.includes('linkedin')) return { source: 'linkedin', medium: 'social', referrer };
    if (host.includes('instagram')) return { source: 'instagram', medium: 'social', referrer };
    if (host.includes('youtube')) return { source: 'youtube', medium: 'social', referrer };
    if (host.includes('reddit')) return { source: 'reddit', medium: 'social', referrer };
    if (host.includes('tiktok')) return { source: 'tiktok', medium: 'social', referrer };
    if (host.includes('pinterest')) return { source: 'pinterest', medium: 'social', referrer };
    
    // Return the domain as source for unknown referrers
    return { source: host.replace('www.', ''), medium: 'referral', referrer };
  } catch {
    return { source: 'direct', referrer };
  }
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0];
    return firstIp ? firstIp.trim() : undefined;
  }
  return req.socket?.remoteAddress;
}

// ============================================
// Get Tenant/User Info by Slug
// ============================================

export async function getTenantBySlug(
  req: Request,
  res: Response<ApiResponse<{ tenant: { username: string; name: string; logoUrl?: string; primaryColor?: string; exists: boolean } }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      throw AppError.badRequest('Slug is required');
    }

    // Find user by username (slug)
    const user = await User.findOne({ username: slug.toLowerCase() }).select('username name brandSettings');

    if (!user) {
      // Return exists: false instead of 404 so frontend can show proper message
      res.json({
        success: true,
        data: {
          tenant: {
            username: slug,
            name: '',
            exists: false,
          },
        },
      });
      return;
    }

    // Return tenant metadata
    res.json({
      success: true,
      data: {
        tenant: {
          username: user.username,
          name: user.name || user.username,
          logoUrl: user.brandSettings?.logoUrl,
          primaryColor: user.brandSettings?.primaryColor,
          exists: true,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Landing Page Data (JSON API)
// ============================================

export async function getLandingPageData(
  req: Request,
  res: Response<ApiResponse<{ leadMagnet: Partial<ILeadMagnet>; brandSettings: IBrandSettings }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

    if (!username || !slug) {
      throw AppError.notFound('Page not found');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Page not found');
    }

    // Find lead magnet
    const leadMagnet = await LeadMagnet.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      isPublished: true,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Page not found');
    }

    // Track page view (async, don't block response)
    const sourceInfo = detectSource(req);
    PageView.create({
      leadMagnetId: leadMagnet._id,
      referrer: sourceInfo.referrer,
      source: sourceInfo.source,
      medium: sourceInfo.medium,
      campaign: sourceInfo.campaign,
      userAgent: req.headers['user-agent'],
      ip: getClientIp(req),
    }).catch((err) => {
      logger.error('Failed to track page view', err);
    });

    // Return data for frontend rendering
    const leadMagnetData = {
      _id: leadMagnet._id,
      title: leadMagnet.title,
      slug: leadMagnet.slug,
      type: leadMagnet.type,
      landingPageCopyJson: leadMagnet.landingPageCopyJson,
      infographicUrl: leadMagnet.infographicUrl,
      infographicStyle: leadMagnet.infographicStyle,
      infographicOrientation: leadMagnet.infographicOrientation,
    };

    const brandSettings = user.brandSettings || DEFAULT_BRAND_SETTINGS;

    res.json({
      success: true,
      data: {
        leadMagnet: leadMagnetData,
        brandSettings,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Serve Landing Page (Legacy HTML rendering)
// ============================================

export async function serveLandingPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

    if (!username || !slug) {
      throw AppError.notFound('Page not found');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Page not found');
    }

    // Find lead magnet
    const leadMagnet = await LeadMagnet.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      isPublished: true,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Page not found');
    }

    // Track page view (async, don't block response)
    const sourceInfo = detectSource(req);
    PageView.create({
      leadMagnetId: leadMagnet._id,
      referrer: sourceInfo.referrer,
      source: sourceInfo.source,
      medium: sourceInfo.medium,
      campaign: sourceInfo.campaign,
      userAgent: req.headers['user-agent'],
      ip: getClientIp(req),
    }).catch((err) => {
      logger.error('Failed to track page view', err);
    });

    let html: string;

    // If we have landing page copy, render using template with user's brand
    if (leadMagnet.landingPageCopyJson) {
      const brandSettings = user.brandSettings || DEFAULT_BRAND_SETTINGS;
      // When served on a username subdomain (publicSubdomain router), keep the
      // form action relative to that origin (/{slug}/subscribe). When served via
      // /public/:username/:slug, keep the legacy /public/... action.
      const isPublicPath = req.baseUrl === '/public';
      const formAction = isPublicPath ? `/public/${username}/${slug}/subscribe` : `/${slug}/subscribe`;
      
      html = await renderLandingPage(
        brandSettings,
        leadMagnet.landingPageCopyJson as ILandingPageCopy,
        formAction
      );
    } else if (leadMagnet.landingPageHtml) {
      // Fallback to stored HTML for backward compatibility
      html = sanitizeHtml(leadMagnet.landingPageHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          'html', 'head', 'body', 'title', 'meta', 'style', 'link',
          'form', 'input', 'button', 'label', 'section', 'header',
          'footer', 'main', 'article', 'aside', 'nav', 'figure',
          'figcaption', 'img', 'svg', 'path'
        ]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          '*': ['class', 'id', 'style'],
          'form': ['action', 'method', 'enctype'],
          'input': ['type', 'name', 'placeholder', 'required', 'value', 'id'],
          'button': ['type', 'disabled'],
          'label': ['for'],
          'img': ['src', 'alt', 'width', 'height'],
          'a': ['href', 'target', 'rel'],
          'meta': ['charset', 'name', 'content', 'property'],
          'link': ['rel', 'href', 'type'],
          'svg': ['viewBox', 'xmlns', 'fill', 'stroke', 'width', 'height'],
          'path': ['d', 'fill', 'stroke'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
      });
    } else {
      throw AppError.notFound('Page not found');
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    next(error);
  }
}

// ============================================
// Subscribe (Lead Capture)
// ============================================

export async function subscribe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;
    // Be defensive: depending on the client's Content-Type (or malformed requests),
    // Express may leave req.body undefined or as a non-object. Avoid runtime crashes.
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : ({} as Record<string, unknown>);
    const email = typeof body.email === 'string' ? body.email : undefined;

    if (!username || !slug) {
      throw AppError.notFound('Page not found');
    }

    if (!email || typeof email !== 'string') {
      throw AppError.badRequest('Email is required');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw AppError.badRequest('Please provide a valid email address');
    }

    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Page not found');
    }

    // Find lead magnet
    const leadMagnet = await LeadMagnet.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      isPublished: true,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Page not found');
    }

    // Check for duplicate email
    const existingLead = await Lead.findOne({
      email: email.toLowerCase(),
      leadMagnetId: leadMagnet._id,
    });

    if (existingLead) {
      // Return success anyway (don't reveal if email exists)
      return redirectToThankYou(req, res, username, slug);
    }

    // Detect traffic source
    const sourceInfo = detectSource(req);

    // Create lead with source tracking
    const lead = await Lead.create({
      email: email.toLowerCase(),
      leadMagnetId: leadMagnet._id,
      deliveryStatus: 'pending',
      referrer: sourceInfo.referrer,
      source: sourceInfo.source,
      medium: sourceInfo.medium,
      campaign: sourceInfo.campaign,
    });

    logger.info('New lead captured', {
      leadId: lead._id,
      leadMagnetId: leadMagnet._id,
      email: email.toLowerCase(),
      source: sourceInfo.source,
    });

    // Send delivery email asynchronously
    if (leadMagnet.emailsJson?.emails?.[0]) {
      const deliveryEmail: IEmail = leadMagnet.emailsJson.emails[0];

      // The stored PDF/Infographic URLs may point at the R2 API hostname (requires auth).
      // For emails, always convert them to time-limited signed URLs so recipients can open them.
      const storedPdfUrl = typeof leadMagnet.pdfUrl === 'string' ? leadMagnet.pdfUrl : '';
      const signedPdfUrl = storedPdfUrl ? await getSignedPdfUrl(storedPdfUrl, 60 * 60 * 24 * 7) : '';
      
      const storedInfographicUrl = typeof leadMagnet.infographicUrl === 'string' ? leadMagnet.infographicUrl : '';
      const signedInfographicUrl = storedInfographicUrl ? await getSignedImageUrl(storedInfographicUrl, 60 * 60 * 24 * 7) : '';
      
      let bodyHtml = deliveryEmail.body_html;
      let bodyText = deliveryEmail.body_text;
      
      // Replace PDF URL
      if (signedPdfUrl) {
        bodyHtml = bodyHtml.replaceAll('{{PDF_URL}}', signedPdfUrl).replaceAll(storedPdfUrl, signedPdfUrl);
        bodyText = bodyText.replaceAll('{{PDF_URL}}', signedPdfUrl).replaceAll(storedPdfUrl, signedPdfUrl);
      }
      
      // Replace Infographic URL
      if (signedInfographicUrl) {
        bodyHtml = bodyHtml.replaceAll('{{INFOGRAPHIC_URL}}', signedInfographicUrl).replaceAll(storedInfographicUrl, signedInfographicUrl);
        bodyText = bodyText.replaceAll('{{INFOGRAPHIC_URL}}', signedInfographicUrl).replaceAll(storedInfographicUrl, signedInfographicUrl);
      }
      
      // Don't await - send in background
      sendDeliveryEmail(
        lead._id.toString(),
        email.toLowerCase(),
        deliveryEmail.subject,
        bodyHtml,
        bodyText
      ).catch((error: unknown) => {
        logger.error('Failed to send delivery email', error);
      });
    }

    // Redirect to thank you page
    redirectToThankYou(req, res, username, slug);
  } catch (error) {
    next(error);
  }
}

function redirectToThankYou(req: Request, res: Response, username: string, slug: string): void {
  const isPublicPath = req.baseUrl === '/public';
  res.redirect(isPublicPath ? `/public/${username}/${slug}/thank-you` : `/${slug}/thank-you`);
}

// ============================================
// Thank You Page
// ============================================

export async function thankYouPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

    if (!username || !slug) {
      throw AppError.notFound('Page not found');
    }

    // Find user and lead magnet for the title
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Page not found');
    }

    const leadMagnet = await LeadMagnet.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
    });

    const title = leadMagnet?.title || 'Your Download';

    // Get brand logo for favicon
    let faviconHtml = '';
    if (leadMagnet?.brandId) {
      const brand = await Brand.findById(leadMagnet.brandId);
      if (brand?.settings?.logoUrl) {
        faviconHtml = `  <link rel="icon" type="image/png" href="${brand.settings.logoUrl}" />`;
      }
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You - ${title}</title>
${faviconHtml}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    :root {
      --bg: #0C0C0C;
      --text: #FAFAFA;
      --text-muted: rgba(255, 255, 255, 0.5);
      --accent: #10B981;
      --accent-glow: rgba(16, 185, 129, 0.15);
    }
    
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: hidden;
    }
    
    /* Ambient gradient background */
    .ambient {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
    }
    
    .ambient::before {
      content: '';
      position: absolute;
      top: -40%;
      left: 50%;
      transform: translateX(-50%);
      width: 120vw;
      height: 120vw;
      max-width: 800px;
      max-height: 800px;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
      animation: pulse 4s ease-in-out infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
      50% { opacity: 0.8; transform: translateX(-50%) scale(1.05); }
    }
    
    /* Content container */
    .content {
      position: relative;
      z-index: 1;
      text-align: center;
      max-width: 560px;
      width: 100%;
    }
    
    /* Animated checkmark */
    .check-container {
      width: 88px;
      height: 88px;
      margin: 0 auto 40px;
      position: relative;
    }
    
    .check-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--accent);
      opacity: 0;
      animation: ringExpand 0.6s ease-out 0.2s forwards;
    }
    
    .check-ring-pulse {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--accent);
      animation: ringPulse 2s ease-out 0.8s infinite;
    }
    
    @keyframes ringExpand {
      0% { transform: scale(0.5); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    
    @keyframes ringPulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.5); opacity: 0; }
    }
    
    .check-icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .check-icon svg {
      width: 36px;
      height: 36px;
      stroke: var(--accent);
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 40;
      stroke-dashoffset: 40;
      animation: checkDraw 0.5s ease-out 0.4s forwards;
    }
    
    @keyframes checkDraw {
      to { stroke-dashoffset: 0; }
    }
    
    /* Typography */
    h1 {
      font-size: clamp(2rem, 6vw, 2.5rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.1;
      margin-bottom: 20px;
      opacity: 0;
      transform: translateY(16px);
      animation: fadeUp 0.6s ease-out 0.5s forwards;
    }
    
    .subtitle {
      font-size: 1rem;
      color: var(--text-muted);
      line-height: 1.6;
      opacity: 0;
      transform: translateY(16px);
      animation: fadeUp 0.6s ease-out 0.65s forwards;
    }
    
    @keyframes fadeUp {
      to { opacity: 1; transform: translateY(0); }
    }
    
    /* Email indicator */
    .email-hint {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-top: 48px;
      padding: 14px 24px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 100px;
      font-size: 0.875rem;
      color: var(--text);
      opacity: 0;
      transform: translateY(16px);
      animation: fadeUp 0.6s ease-out 0.8s forwards;
    }
    
    .email-hint svg {
      width: 18px;
      height: 18px;
      stroke: var(--accent);
      fill: none;
      stroke-width: 1.5;
    }
    
    .spam-hint {
      margin-top: 16px;
      font-size: 0.8125rem;
      color: var(--text-muted);
      opacity: 0;
      animation: fadeIn 0.5s ease-out 1s forwards;
    }
    
    /* Footer */
    .footer {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.75rem;
      color: var(--text-muted);
      opacity: 0;
      animation: fadeIn 0.5s ease-out 1.2s forwards;
    }
    
    .footer a {
      color: inherit;
      text-decoration: none;
      transition: color 0.2s;
    }
    
    .footer a:hover {
      color: var(--text);
    }
    
    @keyframes fadeIn {
      to { opacity: 1; }
    }
    
    /* Confetti */
    .confetti {
      position: fixed;
      width: 10px;
      height: 10px;
      background: var(--accent);
      opacity: 0;
      pointer-events: none;
    }
    
    @keyframes confettiFall {
      0% { 
        transform: translateY(-100vh) rotate(0deg);
        opacity: 1;
      }
      100% { 
        transform: translateY(100vh) rotate(720deg);
        opacity: 0;
      }
    }
  </style>
</head>
<body>
  <!-- Ambient background -->
  <div class="ambient"></div>
  
  <!-- Confetti particles -->
  <div id="confetti"></div>
  
  <!-- Main content -->
  <main class="content">
    <div class="check-container">
      <div class="check-ring"></div>
      <div class="check-ring-pulse"></div>
      <div class="check-icon">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
    </div>
    
    <h1>It's on the way</h1>
    <p class="subtitle">${title}</p>
    
    <div class="email-hint">
      <svg viewBox="0 0 24 24">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M22 7l-10 7L2 7"/>
      </svg>
      <span>Check your inbox</span>
    </div>
    <p class="spam-hint">Not there? Check your spam folder</p>
  </main>
  
  <footer class="footer">
    <a href="https://magnethubai.com" target="_blank" rel="noopener">Powered by MagnetHub</a>
    
  </footer>
  
  <script>
    // Minimal confetti celebration
    (function() {
      const container = document.getElementById('confetti');
      const colors = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0'];
      const count = 25;
      
      for (let i = 0; i < count; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = (Math.random() * 8 + 4) + 'px';
        confetti.style.height = confetti.style.width;
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        confetti.style.animation = 'confettiFall ' + (Math.random() * 2 + 2) + 's ease-out ' + (Math.random() * 0.5 + 0.3) + 's forwards';
        container.appendChild(confetti);
      }
      
      // Clean up after animation
      setTimeout(() => container.innerHTML = '', 4000);
    })();
  </script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    next(error);
  }
}

// ============================================
// API Version of Subscribe (for AJAX)
// ============================================

export async function subscribeApi(
  req: Request,
  res: Response<ApiResponse<{ message: string }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;
    // Be defensive: depending on the client's Content-Type (or malformed requests),
    // Express may leave req.body undefined or as a non-object. Avoid runtime crashes.
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : ({} as Record<string, unknown>);
    const email = typeof body.email === 'string' ? body.email : undefined;

    if (!username || !slug) {
      throw AppError.notFound('Page not found');
    }

    if (!email || typeof email !== 'string') {
      throw AppError.badRequest('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw AppError.badRequest('Please provide a valid email address');
    }

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      throw AppError.notFound('Page not found');
    }

    const leadMagnet = await LeadMagnet.findOne({
      userId: user._id,
      slug: slug.toLowerCase(),
      isPublished: true,
    });

    if (!leadMagnet) {
      throw AppError.notFound('Page not found');
    }

    const existingLead = await Lead.findOne({
      email: email.toLowerCase(),
      leadMagnetId: leadMagnet._id,
    });

    if (!existingLead) {
      // Detect traffic source
      const sourceInfo = detectSource(req);

      const lead = await Lead.create({
        email: email.toLowerCase(),
        leadMagnetId: leadMagnet._id,
        deliveryStatus: 'pending',
        referrer: sourceInfo.referrer,
        source: sourceInfo.source,
        medium: sourceInfo.medium,
        campaign: sourceInfo.campaign,
      });

      logger.info('New lead captured (API)', {
        leadId: lead._id,
        leadMagnetId: leadMagnet._id,
        source: sourceInfo.source,
      });

      if (leadMagnet.emailsJson?.emails?.[0]) {
        const deliveryEmail: IEmail = leadMagnet.emailsJson.emails[0];

        const storedPdfUrl = typeof leadMagnet.pdfUrl === 'string' ? leadMagnet.pdfUrl : '';
        const signedPdfUrl = storedPdfUrl ? await getSignedPdfUrl(storedPdfUrl, 60 * 60 * 24 * 7) : '';
        const bodyHtml = signedPdfUrl
          ? deliveryEmail.body_html.replaceAll('{{PDF_URL}}', signedPdfUrl).replaceAll(storedPdfUrl, signedPdfUrl)
          : deliveryEmail.body_html;
        const bodyText = signedPdfUrl
          ? deliveryEmail.body_text.replaceAll('{{PDF_URL}}', signedPdfUrl).replaceAll(storedPdfUrl, signedPdfUrl)
          : deliveryEmail.body_text;

        sendDeliveryEmail(
          lead._id.toString(),
          email.toLowerCase(),
          deliveryEmail.subject,
          bodyHtml,
          bodyText
        ).catch((error: unknown) => {
          logger.error('Failed to send delivery email', error);
        });
      }
    }

    res.json({
      success: true,
      data: { message: 'Check your email for the download link!' },
    });
  } catch (error) {
    next(error);
  }
}

