import type { Response, NextFunction } from 'express';
import passport from 'passport';
import slugify from 'slugify';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { SlackService } from '../services/slackService.js';
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
  req: AuthenticatedRequest,
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

    // Log the user in
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }

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
  req: AuthenticatedRequest,
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
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): void {
  const userId = req.user?._id;

  req.logout((err) => {
    if (err) {
      return next(err);
    }

    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        logger.warn('Error destroying session', sessionErr);
      }

      res.clearCookie('connect.sid');
      
      logger.info('User logged out', { userId });

      // Redirect to landing page
      res.redirect(config.landingUrl);
    });
  });
}

// ============================================
// Get Current User
// ============================================

export function getCurrentUser(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ user: IUserPublic | null }>>
): void {
  if (req.user) {
    res.json({
      success: true,
      data: { user: sanitizeUser(req.user) },
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
  req: AuthenticatedRequest,
  res: Response
): void {
  // Successful authentication, redirect to client
  logger.info('User authenticated via Google', { userId: req.user?._id });
  res.redirect(`${config.clientUrl}/dashboard`);
}

// ============================================
// Update Profile
// ============================================

export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { name, username } = req.body;
    const updates: { name?: string; username?: string } = {};

    if (name !== undefined) {
      updates.name = name;
    }

    if (username !== undefined) {
      // Check if username is taken
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        _id: { $ne: req.user._id }
      });

      if (existingUser) {
        throw AppError.conflict('This username is already taken');
      }

      updates.username = username.toLowerCase();
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
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
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ user: IUserPublic }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
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
    const currentBrand = req.user.brandSettings || {};
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
      req.user._id,
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

