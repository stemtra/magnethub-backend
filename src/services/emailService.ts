import Mailgun from 'mailgun.js';
import formData from 'form-data';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Lead } from '../models/Lead.js';
import type { IQuiz, IQuizResult } from '../types/index.js';

// ============================================
// Types for Template Emails
// ============================================

export interface SendEmailArgs {
  to: string;
  subject: string;
  template: {
    name: string;
    variables: Record<string, any>;
  };
}

// ============================================
// Mailgun Client
// ============================================

const mailgun = new Mailgun(formData);
const mg = config.mailgun.apiKey 
  ? mailgun.client({ username: 'api', key: config.mailgun.apiKey })
  : null;

// ============================================
// Send Delivery Email
// ============================================

export async function sendDeliveryEmail(
  leadId: string,
  recipientEmail: string,
  subject: string,
  htmlBody: string,
  textBody: string
): Promise<boolean> {
  if (!mg) {
    logger.warn('Mailgun not configured, skipping email send');
    return false;
  }

  try {
    logger.info('Sending delivery email', { leadId, recipientEmail });

    await mg.messages.create(config.mailgun.domain, {
      from: 'MagnetHub AI <hello@magnethubai.com>',
      to: recipientEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });

    // Update lead status
    await Lead.findByIdAndUpdate(leadId, { deliveryStatus: 'sent' });

    logger.info('Delivery email sent successfully', { leadId, recipientEmail });
    return true;
  } catch (error) {
    logger.error('Failed to send delivery email', { leadId, error });

    // Update lead status to failed
    await Lead.findByIdAndUpdate(leadId, { deliveryStatus: 'failed' });

    return false;
  }
}

// ============================================
// Send Email with Template
// ============================================

export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  console.log('🔍 DEBUG: sendEmail called with args:', {
    to: args.to,
    template: args.template.name,
    subject: args.subject,
    variables: args.template.variables
  });

  console.log('🔍 DEBUG: Mailgun configuration check:', {
    apiKeyExists: !!config.mailgun.apiKey,
    domainExists: !!config.mailgun.domain,
    mgClientExists: !!mg,
    apiKeyLength: config.mailgun.apiKey ? config.mailgun.apiKey.length : 0
  });

  if (!mg) {
    console.log('❌ DEBUG: Mailgun not configured, skipping email send');
    logger.warn('Mailgun not configured, skipping email send');
    return false;
  }

  try {
    console.log('📧 DEBUG: About to send template email to Mailgun');
    logger.info('Sending template email', {
      to: args.to,
      template: args.template.name,
      subject: args.subject
    });

    const messageData = {
      from: config.mailgun.fromEmail,
      to: args.to,
      subject: args.subject,
      template: args.template.name,
      'h:X-Mailgun-Variables': JSON.stringify(args.template.variables),
    };

    console.log('📧 DEBUG: Mailgun message data:', messageData);

    const result = await mg.messages.create(config.mailgun.domain, messageData);
    console.log('✅ DEBUG: Mailgun API response:', result);

    logger.info('Template email sent successfully', {
      to: args.to,
      template: args.template.name
    });
    return true;
  } catch (error) {
    console.log('❌ DEBUG: Failed to send template email - Error:', error);
    logger.error('Failed to send template email', {
      to: args.to,
      template: args.template.name,
      error
    });
    return false;
  }
}

// ============================================
// Check if email service is configured
// ============================================

export function isEmailConfigured(): boolean {
  return !!(config.mailgun.apiKey && config.mailgun.domain);
}

// ============================================
// Payment Failure Email
// ============================================

export async function sendPaymentFailureEmail(params: {
  to: string;
  name: string;
  plan: string;
  amountDueCents?: number;
  billingUrl: string;
  errorMessage?: string;
}): Promise<boolean> {
  if (!mg) {
    logger.warn('Mailgun not configured, skipping payment failure email');
    return false;
  }

  const amount =
    params.amountDueCents && params.amountDueCents > 0
      ? `$${(params.amountDueCents / 100).toFixed(2)}`
      : 'your subscription';

  const subject = `[Action required]: update payment for your ${params.plan} plan`;

  const textBody = [
    `Hi ${params.name || 'there'},`,
    '',
    `We couldn't process the payment for your ${params.plan} plan.`,
    params.errorMessage ? `Details: ${params.errorMessage}` : '',
    '',
    `Please update your payment method to keep your account active: ${params.billingUrl}`,
    '',
    'If you have any questions, just reply to this email.',
    '',
    ', The MagnetHub team',
  ]
    .filter(Boolean)
    .join('\n');

  const htmlBody = `
    <p>Hi ${params.name || 'there'},</p>
    <p>We couldn't process the payment for your <strong>${params.plan}</strong> plan.</p>
    ${params.errorMessage ? `<p><strong>Details:</strong> ${params.errorMessage}</p>` : ''}
    <p>Please update your payment method to keep your account active.</p>
    <p><a href="${params.billingUrl}" target="_blank" rel="noopener noreferrer" style="background:#10B981;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;display:inline-block;">Update payment</a></p>
    <p style="color:#6b7280;font-size:14px;">If you have any questions, just reply to this email.</p>
    <p>, The MagnetHub team</p>
  `;

  try {
    await mg.messages.create(config.mailgun.domain, {
      from: config.mailgun.fromEmail,
      to: params.to,
      subject,
      text: textBody,
      html: htmlBody,
    });

    logger.info('Payment failure email sent', { to: params.to, plan: params.plan });
    return true;
  } catch (error) {
    logger.error('Failed to send payment failure email', { to: params.to, error });
    return false;
  }
}

// ============================================
// Quiz Result Email
// ============================================

export interface QuizResultEmailParams {
  to: string;
  firstName?: string;
  quiz: IQuiz;
  result: IQuizResult;
}

export async function sendQuizResultEmail(params: QuizResultEmailParams): Promise<boolean> {
  if (!mg) {
    logger.warn('Mailgun not configured, skipping quiz result email');
    return false;
  }

  const { to, firstName, quiz, result } = params;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';

  const subject = `Your ${quiz.title} Result: ${result.name} ${result.emoji || ''}`.trim();

  // Build traits list
  const traitsText = result.traits.map((t) => `• ${t}`).join('\n');
  const traitsHtml = result.traits.map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  // Plain text version
  const textBody = `${greeting},

Thanks for taking "${quiz.title}"!

Based on your answers, you're a ${result.name}${result.emoji ? ` ${result.emoji}` : ''}.

${result.summary}

YOUR TRAITS:
${traitsText}

${result.recommendation ? `MY RECOMMENDATION:\n${result.recommendation}\n` : ''}
${result.ctaText && result.ctaUrl ? `\n${result.ctaText}: ${result.ctaUrl}\n` : ''}
Thanks for taking the quiz!

, Powered by MagnetHub
`;

  // HTML version with styling
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${quiz.theme === 'light' ? '#f9fafb' : '#0c0c0c'}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">
    <tr>
      <td style="padding: 40px 20px;">
        <!-- Header -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="text-align: center; padding-bottom: 30px;">
              ${quiz.logoUrl ? `<img src="${escapeHtml(quiz.logoUrl)}" alt="" style="max-height: 50px; max-width: 150px;">` : ''}
            </td>
          </tr>
        </table>

        <!-- Main Card -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${quiz.theme === 'light' ? '#ffffff' : '#1a1a1a'}; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="padding: 40px 30px;">
              <!-- Greeting -->
              <p style="margin: 0 0 20px; font-size: 16px; color: ${quiz.theme === 'light' ? '#374151' : '#d1d5db'};">
                ${escapeHtml(greeting)},
              </p>
              
              <p style="margin: 0 0 30px; font-size: 16px; color: ${quiz.theme === 'light' ? '#374151' : '#d1d5db'};">
                Thanks for taking my "<strong>${escapeHtml(quiz.title)}</strong>"!
              </p>

              <!-- Result -->
              <div style="text-align: center; padding: 30px 0; border-top: 1px solid ${quiz.theme === 'light' ? '#e5e7eb' : '#374151'}; border-bottom: 1px solid ${quiz.theme === 'light' ? '#e5e7eb' : '#374151'};">
                <p style="margin: 0 0 10px; font-size: 14px; color: ${quiz.theme === 'light' ? '#6b7280' : '#9ca3af'}; text-transform: uppercase; letter-spacing: 1px;">
                  You're a...
                </p>
                ${result.emoji ? `<p style="margin: 0 0 10px; font-size: 48px;">${result.emoji}</p>` : ''}
                <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: ${quiz.primaryColor || '#10B981'};">
                  ${escapeHtml(result.name)}
                </h1>
              </div>

              <!-- Summary -->
              <div style="padding: 30px 0;">
                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: ${quiz.theme === 'light' ? '#374151' : '#d1d5db'};">
                  ${escapeHtml(result.summary)}
                </p>
              </div>

              <!-- Traits -->
              <div style="padding: 20px; background-color: ${quiz.theme === 'light' ? '#f3f4f6' : '#262626'}; border-radius: 12px; margin-bottom: 30px;">
                <h3 style="margin: 0 0 15px; font-size: 14px; font-weight: 600; color: ${quiz.theme === 'light' ? '#374151' : '#f3f4f6'}; text-transform: uppercase; letter-spacing: 1px;">
                  Your Traits
                </h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: ${quiz.theme === 'light' ? '#4b5563' : '#d1d5db'}; font-size: 15px; line-height: 1.8;">
                  ${traitsHtml}
                </ul>
              </div>

              <!-- Recommendation -->
              ${result.recommendation ? `
              <div style="padding-bottom: 30px;">
                <h3 style="margin: 0 0 15px; font-size: 14px; font-weight: 600; color: ${quiz.theme === 'light' ? '#374151' : '#f3f4f6'}; text-transform: uppercase; letter-spacing: 1px;">
                  My Recommendation
                </h3>
                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: ${quiz.theme === 'light' ? '#374151' : '#d1d5db'};">
                  ${escapeHtml(result.recommendation)}
                </p>
              </div>
              ` : ''}

              <!-- CTA Button -->
              ${result.ctaText && result.ctaUrl ? `
              <div style="text-align: center; padding: 20px 0;">
                <a href="${escapeHtml(result.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 16px 32px; background-color: ${quiz.primaryColor || '#10B981'}; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                  ${escapeHtml(result.ctaText)}
                </a>
              </div>
              ` : ''}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="text-align: center; padding-top: 30px;">
              <p style="margin: 0; font-size: 12px; color: ${quiz.theme === 'light' ? '#9ca3af' : '#6b7280'};">
                Powered by <a href="https://magnethubai.com" target="_blank" rel="noopener noreferrer" style="color: ${quiz.theme === 'light' ? '#6b7280' : '#9ca3af'};">MagnetHub</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  try {
    await mg.messages.create(config.mailgun.domain, {
      from: 'MagnetHub AI <hello@magnethubai.com>',
      to,
      subject,
      text: textBody,
      html: htmlBody,
    });

    logger.info('Quiz result email sent', {
      to,
      quizId: quiz._id,
      resultName: result.name,
    });
    return true;
  } catch (error) {
    logger.error('Failed to send quiz result email', {
      to,
      quizId: quiz._id,
      error,
    });
    return false;
  }
}

// Helper to escape HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

