import type { Request, Response } from 'express';

import { isDev } from '../config/env';
import { testEmail } from '../emails/templates';
import { User } from '../models/User';
import { normaliseRecipient } from '../services/emailMessage';
import { sendEmail, smtpHint, smtpProblems } from '../services/emailService';
import { fail, ok } from '../utils/http';

/**
 * POST /api/email/test  { to? }
 *
 * Sends one test email through SMTP — never the Resend fallback, because the
 * point is to find out whether SMTP works.
 *
 * **Development only.** `routes/index.ts` mounts it only when NODE_ENV is
 * `development`, so everywhere else the path does not exist. The check below
 * repeats that, so a future refactor of the mount cannot open it by accident.
 *
 * Even in development it is signed-in and rate-limited: the dev server binds
 * every interface, so anyone on the same network can reach it, and an open
 * "send mail to any address" endpoint is a relay.
 *
 * On failure it answers with the transport's error code and a hint that names
 * variables. It never returns — or logs — a credential.
 */
export async function sendTestEmail(req: Request, res: Response): Promise<Response> {
  if (!isDev) return fail(res, 'Not found', 404);

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = await User.findById(req.user!.userId).select('email displayName').lean();
    if (!user) return fail(res, 'User not found', 404);

    const to = body.to === undefined || body.to === '' ? user.email : normaliseRecipient(body.to);
    if (!to) {
      return fail(res, 'Give one valid email address in "to", or leave it out to use your own', 422);
    }

    const problems = smtpProblems();
    if (problems.length) {
      return fail(res, `SMTP is not configured. ${problems.join('. ')}.`, 503);
    }

    const result = await sendEmail(
      { to, ...testEmail({ displayName: user.displayName, at: new Date() }) },
      { only: 'smtp' },
    );

    if (result.sent) {
      return ok(res, { sent: true, transport: result.transport, to, messageId: result.messageId });
    }
    return fail(
      res,
      `The SMTP server did not accept the message${result.code ? ` (${result.code})` : ''}. ${smtpHint(result.code)}`,
      502,
    );
  } catch (err) {
    console.error('sendTestEmail error:', err instanceof Error ? err.message : 'unknown');
    return fail(res, 'Could not send a test email', 500);
  }
}
