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
      from: `MagnetHub <noreply@${config.mailgun.domain}>`,
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
  if (!mg) {
    logger.warn('Mailgun not configured, skipping email send');
    return false;
  }

  try {
    logger.info('Sending template email', {
      to: args.to,
      template: args.template.name,
      subject: args.subject
    });

    await mg.messages.create(config.mailgun.domain, {
      from: `MagnetHub <noreply@${config.mailgun.domain}>`,
      to: args.to,
      subject: args.subject,
      template: args.template.name,
      'h:X-Mailgun-Variables': JSON.stringify(args.template.variables),
    });

    logger.info('Template email sent successfully', {
      to: args.to,
      template: args.template.name
    });
    return true;
  } catch (error) {
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

