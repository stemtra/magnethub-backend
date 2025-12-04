import { SendEmailArgs } from '../services/emailService.js';
import { config } from '../config/index.js';

// Helper function to format dates for emails
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

// Email Templates
// These functions return the email configuration to be passed to sendEmail()

export function welcomeEmail(userEmail: string, userName: string, demoUrl: string): SendEmailArgs {
  return {
    to: userEmail,
    subject: "You're about to get thousands of leads",
    template: {
      name: 'welcome-email',
      variables: {
        firstName: userName.split(' ')[0] || "let's get started",
        demoUrl: demoUrl,
        logoUrl: config.logoUrl
      }
    }
  };
}

export function proMonthlyUpgradeEmail(userEmail: string, userName: string, nextBillingDate: Date, auditsUrl: string): SendEmailArgs {
  return {
    to: userEmail,
    subject: "Welcome to MagnetHub Pro!",
    template: {
      name: 'pro-monthly-upgrade',
      variables: {
        firstName: userName.split(' ')[0] || "let's get started",
        nextBillingDate: formatDate(nextBillingDate),
        auditsUrl: auditsUrl,
        logoUrl: config.logoUrl
      }
    }
  };
}

export function proAnnualUpgradeEmail(userEmail: string, userName: string, renewalDate: Date, auditsUrl: string): SendEmailArgs {
  return {
    to: userEmail,
    subject: "Welcome to MagnetHub Pro!",
    template: {
      name: 'pro-annual-upgrade',
      variables: {
        firstName: userName.split(' ')[0] || "let's get started",
        renewalDate: formatDate(renewalDate),
        auditsUrl: auditsUrl,
        logoUrl: config.logoUrl
      }
    }
  };
}

export function cancellationEmail(userEmail: string, userName: string, periodEndDate: Date, billingUrl: string): SendEmailArgs {
  return {
    to: userEmail,
    subject: `Sorry we disappointed you...`,
    template: {
      name: 'subscription-cancellation',
      variables: {
        firstName: userName.split(' ')[0] || "goodbye",
        periodEndDate: formatDate(periodEndDate),
        billingUrl: billingUrl,
        logoUrl: config.logoUrl
      }
    }
  };
}
