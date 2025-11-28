import Mailgun from 'mailgun.js';
import formData from 'form-data';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Lead } from '../models/Lead.js';

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
// Check if email service is configured
// ============================================

export function isEmailConfigured(): boolean {
  return !!(config.mailgun.apiKey && config.mailgun.domain);
}

