/**
 * Every email Velvet can send, as `(input) → { subject, html, text }`.
 *
 * Rendering only: nothing here sends, reads the database or knows a transport.
 * `services/email.ts` decides who gets which; `services/emailService.ts` sends.
 */
export { loginAlert, type LoginAlertInput } from './loginAlert';
export { newFollower, type NewFollowerInput } from './newFollower';
export { newMessage, type NewMessageInput } from './newMessage';
export { passwordChanged, type PasswordChangedInput } from './passwordChanged';
export { resetPassword, type ResetPasswordInput } from './resetPassword';
export { securityAlert, type SecurityAlertInput } from './securityAlert';
export { testEmail } from './testEmail';
export { verifyEmail, type VerifyEmailInput } from './verifyEmail';
export { welcome, type WelcomeInput } from './welcome';
