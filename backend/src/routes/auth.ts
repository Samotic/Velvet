import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import {
  checkUsername,
  completeOnboarding,
  forgotPassword,
  googleCallback,
  googleStart,
  login,
  logout,
  me,
  onboardingProfile,
  onboardingStatus,
  onboardingStep,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import { isTest } from '../config/env';

const router = Router();

/**
 * Throttle the credential endpoints to blunt brute-force / mass-signup abuse.
 * Disabled under NODE_ENV=test so the verify script can hammer it freely.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
  skip: () => isTest,
});

/**
 * The handle check fires as the onboarding form is typed into (debounced), so
 * it gets its own much higher ceiling — sharing `authLimiter` would lock a
 * user out of signing up simply for typing their own name.
 */
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment.' },
  skip: () => isTest,
});

/**
 * Anything that puts a message in someone's inbox gets a tighter ceiling than
 * the credential endpoints: the cost of abuse here is paid by a third party
 * (the person being emailed) and by the sending domain's reputation.
 */
const mailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many emails requested. Please try again later.' },
  skip: () => isTest,
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

/* --- email verification --- */
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', mailLimiter, requireAuth, resendVerification);

/* --- password reset --- */
router.post('/forgot-password', mailLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

/* --- sign in with Google --- */
// Both are browser redirects, not XHR: the user is navigating, not fetching.
router.get('/google', authLimiter, googleStart);

// The callback is served at BOTH spellings, and they are the same handler.
// Google matches the registered redirect URI byte for byte, so whichever of
// these is in the Cloud console, it lands. Point GOOGLE_CALLBACK_URL at the one
// you registered — that value is what gets sent on both legs of the flow.
//   /api/auth/google/callback   — this project's own convention
//   /api/auth/callback/google   — the passport / NextAuth convention
router.get('/google/callback', googleCallback);
router.get('/callback/google', googleCallback);

router.get('/check-username', lookupLimiter, checkUsername);
router.get('/onboarding-status', requireAuth, onboardingStatus);
router.post('/complete-onboarding', requireAuth, completeOnboarding);

/* --- the three onboarding steps --- */
router.post('/onboarding/profile', requireAuth, onboardingProfile);
router.post('/onboarding/step', requireAuth, onboardingStep);

export default router;
