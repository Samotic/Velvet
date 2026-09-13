import type { EmailContent } from '../emails/layout';
import {
  loginAlert,
  newFollower,
  newMessage,
  passwordChanged,
  resetPassword,
  securityAlert,
  verifyEmail,
  welcome,
  type LoginAlertInput,
  type NewFollowerInput,
  type NewMessageInput,
  type PasswordChangedInput,
  type ResetPasswordInput,
  type SecurityAlertInput,
  type VerifyEmailInput,
  type WelcomeInput,
} from '../emails/templates';
import { sendEmail, type SendOptions } from './emailService';

/**
 * The named emails Velvet sends — what controllers and `notify()` call.
 *
 * Three layers, one job each:
 *   emails/templates/*        what an email says: subject, HTML, plain text
 *   services/email.ts         which email, to whom — this file
 *   services/emailService.ts  how it leaves: SMTP, the Resend fallback, or not at all
 *
 * Every sender resolves to whether the email went out, and none throws. An
 * email failing must not fail the action that triggered it: a follow still
 * lands, an account is still created, a password is still reset.
 */

async function deliver(
  to: string,
  render: () => EmailContent,
  options?: SendOptions,
): Promise<boolean> {
  try {
    const content = render();
    return (await sendEmail({ to, ...content }, options)).sent;
  } catch (err) {
    // A template that throws is a bug — and still must not fail the action.
    console.error('email render error:', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

/** Verify your address — sent the moment a local account is created. */
export function sendVerificationEmail(opts: { to: string } & VerifyEmailInput): Promise<boolean> {
  return deliver(opts.to, () => verifyEmail(opts));
}

/** Welcome — sent once, immediately after the address is verified. */
export function sendWelcomeEmail(opts: { to: string } & WelcomeInput): Promise<boolean> {
  return deliver(opts.to, () => welcome(opts));
}

/** Password reset link. */
export function sendPasswordResetEmail(opts: { to: string } & ResetPasswordInput): Promise<boolean> {
  return deliver(opts.to, () => resetPassword(opts));
}

/** Somebody sent you a message. */
export function sendNewMessageEmail(opts: { to: string } & NewMessageInput): Promise<boolean> {
  return deliver(opts.to, () => newMessage(opts));
}

/** Somebody followed you. */
export function sendNewFollowerEmail(opts: { to: string } & NewFollowerInput): Promise<boolean> {
  return deliver(opts.to, () => newFollower(opts));
}

/**
 * New login to your account.
 *
 * **SMTP only** — it never falls back to Resend. Login alerts were specified
 * against the SMTP service, and a fallback would quietly send them through a
 * sender the operator may not have set up for real users.
 */
export function sendLoginAlertEmail(opts: { to: string } & LoginAlertInput): Promise<boolean> {
  return deliver(opts.to, () => loginAlert(opts), { only: 'smtp' });
}

/** Your password was changed. Rendered and ready; nothing sends it yet. */
export function sendPasswordChangedEmail(opts: { to: string } & PasswordChangedInput): Promise<boolean> {
  return deliver(opts.to, () => passwordChanged(opts));
}

/** A general security notice. Rendered and ready; nothing sends it yet. */
export function sendSecurityAlertEmail(opts: { to: string } & SecurityAlertInput): Promise<boolean> {
  return deliver(opts.to, () => securityAlert(opts));
}
