import rateLimit from 'express-rate-limit';

export const quizSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 submissions per IP
  message: 'Too many quiz submissions. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
