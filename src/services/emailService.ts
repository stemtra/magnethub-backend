import Mailgun from 'mailgun.js';
import formData from 'form-data';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Lead } from '../models/Lead.js';

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
      from: config.mailgun.fromEmail,
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
    '— The MagnetHub team',
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
    <p>— The MagnetHub team</p>
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

