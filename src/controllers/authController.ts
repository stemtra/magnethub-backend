import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import slugify from 'slugify';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { SlackService } from '../services/slackService.js';
import { welcomeEmail } from '../templates/emailTemplates.js';
import { sendEmail } from '../services/emailService.js';
import { setSentryUser, clearSentryUser } from '../utils/sentry.js';
import type { AuthenticatedRequest, IUserPublic, ApiResponse, IBrandSettings, IUser } from '../types/index.js';

// ============================================
// Helper Functions
// ============================================

function sanitizeUser(user: { 
  _id: { toString(): string }; 
  email: string; 
  name: string; 
  username: string; 
  brandSettings?: IBrandSettings;
  createdAt: Date;
}): IUserPublic {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    username: user.username,
    brandSettings: user.brandSettings,
    createdAt: user.createdAt,
  };
}

async function generateUniqueUsername(base: string): Promise<string> {
  let username = slugify(base, { lower: true, strict: true });
  
  if (username.length < 3) {
    username = `user${username}`;
  }
  // Avoid reserved subdomains (e.g., app/api/www)
  if (config.publicReservedSubdomains.includes(username)) {
    username = `user-${username}`.slice(0, 30);
  }
  
  if (username.length > 30) {
    username = username.slice(0, 30);
  }

  let finalUsername = username;
  let counter = 1;

  while (await User.findOne({ username: finalUsername })) {
    finalUsername = `${username.slice(0, 26)}${counter}`;
    counter++;
  }

  return finalUsername;
}

// ============================================
// Register
// ============================================

export async function register(
  req: Request,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw AppError.conflict('An account with this email already exists');
    }

    // Generate username from name or email
    const baseUsername = name || email.split('@')[0];
    const username = await generateUniqueUsername(baseUsername);

    // Create user
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      name,
      username,
    });

    logger.info('New user registered', { userId: user._id, email });

    // Send Slack notification for new user
    try {
      await SlackService.sendNewUserNotification(user.email, user.name);
    } catch (slackError) {
      logger.error('Failed to send Slack notification for new user:', slackError as Error);
    }

    // Send welcome email
    console.log('👤 DEBUG: About to send welcome email for user:', {
      userId: user._id,
      email: user.email,
      name: user.name,
      configClientUrl: config.clientUrl
    });

    try {
      const demoUrl = `${config.clientUrl}/dashboard`;
      console.log('📧 DEBUG: Welcome email demo URL:', demoUrl);

      const emailArgs = welcomeEmail(user.email, user.name, demoUrl);
      console.log('📧 DEBUG: Welcome email args:', emailArgs);

      const emailResult = await sendEmail(emailArgs);
      console.log('📧 DEBUG: Welcome email send result:', emailResult);

      if (emailResult) {
        console.log('✅ DEBUG: Welcome email sent successfully');
      } else {
        console.log('❌ DEBUG: Welcome email failed to send');
      }
    } catch (emailError) {
      console.log('❌ DEBUG: Exception while sending welcome email:', emailError);
      logger.error('Failed to send welcome email:', emailError as Error);
      // Don't fail registration if email fails
    }

    // Log the user in
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }

      // Set Sentry user context
      setSentryUser({ id: user._id.toString(), email: user.email });

      res.status(201).json({
        success: true,
        data: { user: sanitizeUser(user) },
      });
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Login
// ============================================

export function login(
  req: Request,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): void {
  passport.authenticate('local', (err: Error | null, user: AuthenticatedRequest['user'], info: { message?: string }) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return next(AppError.unauthorized(info?.message || 'Invalid credentials'));
    }

    req.login(user, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }

      logger.info('User logged in', { userId: user._id });

      // Set Sentry user context
      setSentryUser({ id: user._id.toString(), email: user.email });

      res.json({
        success: true,
        data: { user: sanitizeUser(user) },
      });
    });
  })(req, res, next);
}

// ============================================
// Logout
// ============================================

export function logout(
  req: Request,
  res: Response<ApiResponse>
): void {
  const userEmail = (req as AuthenticatedRequest).user?.email || 'unknown';

  req.logout((err) => {
    if (err) {
      logger.error('Error during logout', err);
      const errorResponse: ApiResponse = {
        success: false,
        error: err.message,
        code: 'LOGOUT_ERROR',
      };
      res.status(500).json(errorResponse);
      return;
    }

    req.session.destroy((err) => {
      if (err) {
        logger.error('Error destroying session', err);
        const errorResponse: ApiResponse = {
          success: false,
          error: err.message,
          code: 'SESSION_DESTROY_ERROR',
        };
        res.status(500).json(errorResponse);
        return;
      }

      logger.info(`User ${userEmail} logged out successfully`);

      // Clear Sentry user context
      clearSentryUser();

      const response: ApiResponse = {
        success: true,
        data: { message: 'Logged out successfully' },
      };

      // Clear session cookie with proper domain for cross-subdomain logout
      const cookieOptions: any = { path: '/' };
      if (config.nodeEnv === 'production') {
        const appUrlObj = new URL(config.clientUrl);
        const hostParts = appUrlObj.hostname.split('.');
        if (hostParts.length >= 2) {
          const baseDomain = hostParts.slice(-2).join('.');
          cookieOptions.domain = `.${baseDomain}`;
        }
      } else {
        cookieOptions.domain = 'localhost';
      }

      res.clearCookie('connect.sid', cookieOptions);
      res.json(response);
    });
  });
}

// ============================================
// Get Current User
// ============================================

export function getCurrentUser(
  req: Request,
  res: Response<ApiResponse<{ user: IUserPublic | null }>>
): void {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user) {
    res.json({
      success: true,
      data: { user: sanitizeUser(authReq.user) },
    });
  } else {
    res.json({
      success: true,
      data: { user: null },
    });
  }
}

// ============================================
// Google OAuth Callback
// ============================================

export function googleCallback(
  req: Request,
  res: Response
): void {
  // Successful authentication, redirect to client
  const authReq = req as AuthenticatedRequest;
  logger.info('User authenticated via Google', { userId: authReq.user?._id });
  
  // Set Sentry user context
  if (authReq.user) {
    setSentryUser({ id: authReq.user._id.toString(), email: authReq.user.email });
  }
  
  res.redirect(`${config.clientUrl}/dashboard`);
}

// ============================================
// Update Profile
// ============================================

export async function updateProfile(
  req: Request,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      throw AppError.unauthorized();
    }

    const { name, username } = req.body;
    const updates: { name?: string; username?: string } = {};

    if (name !== undefined) {
      updates.name = name;
    }

    if (username !== undefined) {
      const normalized = String(username).toLowerCase();
      if (config.publicReservedSubdomains.includes(normalized)) {
        throw AppError.badRequest('This subdomain is reserved. Please choose a different one.');
      }
      // Check if username is taken
      const existingUser = await User.findOne({
        username: normalized,
        _id: { $ne: authReq.user._id }
      });

      if (existingUser) {
        throw AppError.conflict('This username is already taken');
      }

      updates.username = normalized;
    }

    const user = await User.findByIdAndUpdate(
      authReq.user._id,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      throw AppError.notFound('User not found');
    }

    logger.info('User profile updated', { userId: user._id });

    res.json({
      success: true,
      data: { user: sanitizeUser(user) },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Update Brand Settings
// ============================================

export async function updateBrandSettings(
  req: Request,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      throw AppError.unauthorized();
    }

    const { 
      primaryColor, 
      accentColor, 
      backgroundColor, 
      textColor, 
      fontFamily, 
      theme, 
      logoUrl 
    } = req.body;

    // Build brand settings update - merge with existing
    const currentBrand: Partial<IBrandSettings> = authReq.user.brandSettings || {};
    const brandSettings: Partial<IBrandSettings> = {
      primaryColor: primaryColor ?? currentBrand.primaryColor ?? '#0C0C0C',
      accentColor: accentColor ?? currentBrand.accentColor ?? '#10B981',
      backgroundColor: backgroundColor ?? currentBrand.backgroundColor ?? '#0C0C0C',
      textColor: textColor ?? currentBrand.textColor ?? '#FAFAFA',
      fontFamily: fontFamily ?? currentBrand.fontFamily ?? 'Plus Jakarta Sans',
      theme: theme ?? currentBrand.theme ?? 'dark',
      logoUrl: logoUrl ?? currentBrand.logoUrl,
    };

    const user = await User.findByIdAndUpdate(
      authReq.user._id,
      { brandSettings },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw AppError.notFound('User not found');
    }

    logger.info('Brand settings updated', { userId: user._id });

    res.json({
      success: true,
      data: { user: sanitizeUser(user) },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Submit Feedback (Authenticated Users)
// ============================================

export async function submitFeedback(
  req: Request,
  res: Response<ApiResponse<{ message: string }>>,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      throw AppError.unauthorized();
    }

    const { category, feedback } = req.body;

    // Validate required fields
    if (!feedback || typeof feedback !== 'string') {
      throw AppError.badRequest('Feedback is required');
    }

    if (feedback.trim().length < 10) {
      throw AppError.badRequest('Feedback must be at least 10 characters long');
    }

    // Optional category validation
    if (category && !['bug', 'feature', 'improvement', 'general'].includes(category)) {
      throw AppError.badRequest('Invalid category');
    }

    // Send Slack notification (don't await to not block response)
    SlackService.sendFeedbackNotification(category, feedback.trim(), authReq.user.email).catch((error) => {
      logger.error('Failed to send feedback Slack notification', error);
    });

    logger.info('Feedback submitted', {
      userId: authReq.user._id,
      category: category || 'none',
      feedbackLength: feedback.trim().length,
    });

    res.json({
      success: true,
      data: { message: 'Thank you for your feedback!' },
    });
  } catch (error) {
    next(error);
  }
}

