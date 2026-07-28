import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import {
  checkUsername,
  completeOnboarding,
  login,
  logout,
  me,
  onboardingStatus,
  register,
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

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

router.get('/check-username', lookupLimiter, checkUsername);
router.get('/onboarding-status', requireAuth, onboardingStatus);
router.post('/complete-onboarding', requireAuth, completeOnboarding);

export default router;
