import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { sendTestEmail } from '../controllers/emailController';
import { requireAuth } from '../middleware/auth';

/**
 * Development-only email tooling.
 *
 * `routes/index.ts` mounts this router only when NODE_ENV is `development`. In
 * production the path is never registered and falls through to the 404
 * catch-all — not a 403, which would admit something lives there.
 */
const router = Router();

/** Even on a laptop, a mail-sending endpoint is somebody's inbox and a sender's reputation. */
const testLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many test emails. Try again later.' },
});

router.post('/test', testLimiter, requireAuth, sendTestEmail);

export default router;
