/** Client-side auth validation. Mirrors the backend rules in
 *  backend/src/utils/validation.ts so users get instant feedback and the two
 *  ends never disagree. */

export const emailValid = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export const usernameValid = (username: string): boolean =>
  /^[a-zA-Z0-9_]{3,20}$/.test(username.trim());

export const passwordValid = (password: string): boolean => password.length >= 8;

export type PasswordStrength = 'weak' | 'medium' | 'strong';

/** Heuristic strength score → weak / medium / strong (drives the meter). */
export function passwordStrength(password: string): { level: PasswordStrength; filled: number } {
  if (!password) return { level: 'weak', filled: 0 };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const level: PasswordStrength = score <= 2 ? 'weak' : score <= 3 ? 'medium' : 'strong';
  const filled = level === 'weak' ? 1 : level === 'medium' ? 2 : 3;
  return { level, filled };
}
