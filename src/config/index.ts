import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  isProd: process.env.NODE_ENV === 'production',

  // Database
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/magnethub',

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Gemini (Google AI)
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER || '',
      pro: process.env.STRIPE_PRICE_PRO || '',
      agency: process.env.STRIPE_PRICE_AGENCY || '',
    },
  },
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map((origin: string) => origin.trim()) || [],
  // Cloudflare R2 (S3-compatible)
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'magnethub-assets',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  // Mailgun
  mailgun: {
    apiKey: process.env.MAILGUN_API_KEY || '',
    domain: process.env.MAILGUN_DOMAIN || 'magnethubai.com',
    fromEmail: process.env.MAILGUN_FROM_EMAIL || 'Stefano from MagnetHub <hello@magnethubai.com>',
  },

  // URLs
  clientUrl: process.env.CLIENT_URL || 'http://localhost:8080',
  landingUrl: process.env.LANDING_URL || 'http://localhost:3000',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:8081',
  logoUrl: process.env.LOGO_URL || 'https://magnethubai.com/MagnetHub%20Isotype.png',
  // Public landing pages (subdomain routing)
  // Example desired: https://{username}.magnethubai.com/{slug}
  publicRootDomain: process.env.PUBLIC_ROOT_DOMAIN || 'magnethubai.com',
  publicReservedSubdomains: (process.env.PUBLIC_RESERVED_SUBDOMAINS || 'app,api,www,quiz')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Optional debug key for troubleshooting public subdomain routing.
  // If set, GET /__debug/host?key=... will return effective host/header info.
  publicDebugKey: process.env.PUBLIC_DEBUG_KEY || '',
  // Email/image assets
  // Public URL to the isotype stored in magnethub-landing/public/MagnetHub Isotype.png
  isotypeUrl: process.env.ISOTYPE_URL || 'https://magnethubai.com/MagnetHub%20Isotype.png',

  // Slack
  slack: {
    webhookMagnethubProduction: process.env.SLACK_WEBHOOK_MAGNETHUB_PRODUCTION || '',
  },

  // Plan limits
  planLimits: {
    free: {
      leadMagnetsTotal: 1, // lifetime limit
      leadsPerMagnet: 100,
      brands: 1,
    },
    starter: {
      leadMagnetsPerMonth: 10,
      leadsPerMagnet: Infinity,
      brands: 1,
    },
    pro: {
      leadMagnetsPerMonth: 30,
      leadsPerMagnet: Infinity,
      brands: 3,
    },
    agency: {
      leadMagnetsPerMonth: 100,
      leadsPerMagnet: Infinity,
      brands: Infinity,
    },
  },
} as const;

// Plan type
export type PlanType = 'free' | 'starter' | 'pro' | 'agency';

// Validate required config in production
export function validateConfig(): void {
  const required = [
    'MONGO_URI',
    'SESSION_SECRET',
    'OPENAI_API_KEY',
  ];

  if (config.isProd) {
    required.push(
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'MAILGUN_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET'
    );
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

