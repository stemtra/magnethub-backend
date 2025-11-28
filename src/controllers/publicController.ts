import type { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { sendDeliveryEmail } from '../services/emailService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { ApiResponse, IEmail } from '../types/index.js';

// ============================================
// Serve Landing Page
// ============================================

export async function serveLandingPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { username, slug } = req.params;

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

    if (!leadMagnet || !leadMagnet.landingPageHtml) {
      throw AppError.notFound('Page not found');
    }

    // Sanitize HTML to prevent XSS (but allow forms)
    const sanitizedHtml = sanitizeHtml(leadMagnet.landingPageHtml, {
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

    res.setHeader('Content-Type', 'text/html');
    res.send(sanitizedHtml);
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
    const { email } = req.body;

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
      return redirectToThankYou(res, username, slug);
    }

    // Create lead
    const lead = await Lead.create({
      email: email.toLowerCase(),
      leadMagnetId: leadMagnet._id,
      deliveryStatus: 'pending',
    });

    logger.info('New lead captured', {
      leadId: lead._id,
      leadMagnetId: leadMagnet._id,
      email: email.toLowerCase(),
    });

    // Send delivery email asynchronously
    if (leadMagnet.emailsJson?.emails?.[0]) {
      const deliveryEmail: IEmail = leadMagnet.emailsJson.emails[0];
      
      // Don't await - send in background
      sendDeliveryEmail(
        lead._id.toString(),
        email.toLowerCase(),
        deliveryEmail.subject,
        deliveryEmail.body_html,
        deliveryEmail.body_text
      ).catch((error: unknown) => {
        logger.error('Failed to send delivery email', error);
      });
    }

    // Redirect to thank you page
    redirectToThankYou(res, username, slug);
  } catch (error) {
    next(error);
  }
}

function redirectToThankYou(res: Response, username: string, slug: string): void {
  res.redirect(`/public/${username}/${slug}/thank-you`);
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

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank You - ${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #FAF8F5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 500px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: #27AE60;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon svg {
      width: 40px;
      height: 40px;
      stroke: white;
      fill: none;
      stroke-width: 3;
    }
    h1 {
      font-size: 28px;
      color: #1a1a1a;
      margin-bottom: 16px;
    }
    p {
      font-size: 16px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 8px;
    }
    .footer {
      margin-top: 40px;
      font-size: 12px;
      color: #999;
    }
    .footer a {
      color: #8B7355;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <h1>Check Your Inbox!</h1>
    <p>Your copy of <strong>${title}</strong> is on its way.</p>
    <p>Please check your email (and spam folder) for the download link.</p>
    <div class="footer">
      <p>Powered by <a href="https://magnethub.ai" target="_blank">MagnetHub</a></p>
    </div>
  </div>
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
    const { email } = req.body;

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
      const lead = await Lead.create({
        email: email.toLowerCase(),
        leadMagnetId: leadMagnet._id,
        deliveryStatus: 'pending',
      });

      logger.info('New lead captured (API)', {
        leadId: lead._id,
        leadMagnetId: leadMagnet._id,
      });

      if (leadMagnet.emailsJson?.emails?.[0]) {
        const deliveryEmail: IEmail = leadMagnet.emailsJson.emails[0];
        sendDeliveryEmail(
          lead._id.toString(),
          email.toLowerCase(),
          deliveryEmail.subject,
          deliveryEmail.body_html,
          deliveryEmail.body_text
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

