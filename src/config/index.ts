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

  // Cloudflare R2 (S3-compatible)
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'magnethub-pdfs',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  // Mailgun
  mailgun: {
    apiKey: process.env.MAILGUN_API_KEY || '',
    domain: process.env.MAILGUN_DOMAIN || 'magnethub.ai',
  },

  // URLs
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:8080',

  // Rate limiting
  rateLimit: {
    freeGenerationsPerDay: 1,
  },
} as const;

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
      'MAILGUN_API_KEY'
    );
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

