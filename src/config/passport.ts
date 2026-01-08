import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/User.js';
import { config } from './index.js';
import { logger } from '../utils/logger.js';
import type { IUser } from '../types/index.js';
import { SlackService } from '../services/slackService.js';

// ============================================
// Serialize / Deserialize
// ============================================

passport.serializeUser((user, done) => {
  done(null, (user as IUser)._id.toString());
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// ============================================
// Local Strategy
// ============================================

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        // Find user with password field included
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        if (!user.password) {
          return done(null, false, { 
            message: 'This account uses Google login. Please sign in with Google.' 
          });
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        logger.error('Local strategy error', error);
        return done(error);
      }
    }
  )
);

// ============================================
// Google OAuth Strategy
// ============================================

if (config.google.clientId && config.google.clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: `${config.publicUrl}/api/auth/google/callback`,
        scope: ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;

          if (!email) {
            return done(null, false, { message: 'No email found in Google profile' });
          }

          // Check if user exists with this Google ID
          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            return done(null, user);
          }

          // Check if user exists with this email
          user = await User.findOne({ email: email.toLowerCase() });

          if (user) {
            // Link Google account to existing user
            user.googleId = profile.id;
            if (!user.name && profile.displayName) {
              user.name = profile.displayName;
            }
            await user.save();
            return done(null, user);
          }

          // Create new user
          const displayName = profile.displayName || email.split('@')[0];
          
          // Generate unique username from email or name
          let baseUsername = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, '');
          if (baseUsername.length < 3) {
            baseUsername = `user${baseUsername}`;
          }
          if (config.publicReservedSubdomains.includes(baseUsername)) {
            baseUsername = `user-${baseUsername}`.slice(0, 30);
          }
          if (baseUsername.length > 30) {
            baseUsername = baseUsername.slice(0, 30);
          }
          
          let username = baseUsername;
          let counter = 1;
          
          // Ensure username is unique
          while (await User.findOne({ username })) {
            username = `${baseUsername.slice(0, 26)}${counter}`;
            counter++;
          }

          user = await User.create({
            email: email.toLowerCase(),
            name: displayName,
            username,
            googleId: profile.id,
          });

          logger.info('New user created via Google OAuth', { userId: user._id, email });

          // Send Slack notification for new user
          try {
            await SlackService.sendNewUserNotification(user.email, user.name);
          } catch (slackError) {
            logger.error('Failed to send Slack notification for new user:', slackError as Error);
          }

          // Send welcome email for Google OAuth users
          try {
            const { sendEmail } = await import('../services/emailService.js');
            const { welcomeEmail } = await import('../templates/emailTemplates.js');
            const { config } = await import('./index.js');

            const demoUrl = `${config.clientUrl}/dashboard`;
            await sendEmail(welcomeEmail(user.email, user.name, demoUrl));
            console.log('✅ DEBUG: Welcome email sent for Google OAuth user');
          } catch (emailError) {
            console.log('❌ DEBUG: Failed to send welcome email for Google OAuth user:', emailError);
          }

          return done(null, user);
        } catch (error) {
          logger.error('Google strategy error', error);
          return done(error as Error);
        }
      }
    )
  );
  
  logger.info('✅ Google OAuth strategy configured');
} else {
  logger.warn('⚠️ Google OAuth not configured (missing credentials)');
}

export default passport;

