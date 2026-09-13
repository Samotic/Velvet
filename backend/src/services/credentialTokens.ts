import crypto from 'crypto';

/**
 * One-time credential tokens: email verification and password reset.
 *
 * What a token is:
 *  - **32 bytes from the CSPRNG**, hex-encoded. Nothing derived from the user —
 *    no id, address or timestamp — so a token read out of an inbox, a log or a
 *    URL bar says nothing about whose it is.
 *  - **Stored hashed.** The raw value only ever exists in the email; the User
 *    document holds its SHA-256. A token is a bearer credential, so a leaked
 *    database dump must not be enough to take an account over. Unsalted and
 *    fast on purpose: the input is 256 bits of randomness, not a guessable
 *    password, so there is nothing for a slow KDF to protect.
 *  - **Expiring.** The expiry sits beside the hash and is checked in the same
 *    query that finds it, so an expired token is indistinguishable from none.
 *  - **Single-use.** The controller clears both fields when it is redeemed.
 *  - **Validated only on the server.** The frontend passes it through and
 *    never parses it.
 *
 * And what it never does: stand in for a password. Nothing in Velvet emails a
 * password, and a reset link sets a new one rather than revealing the old.
 */

export const TOKEN_TTL_MS = {
  emailVerification: 24 * 60 * 60 * 1000,
  passwordReset: 60 * 60 * 1000,
} as const;

export type CredentialTokenKind = keyof typeof TOKEN_TTL_MS;

export function mintCredentialToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashCredentialToken(raw) };
}

export function hashCredentialToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** The expiry to store beside a freshly minted token. */
export function expiresAt(kind: CredentialTokenKind, from: number = Date.now()): Date {
  return new Date(from + TOKEN_TTL_MS[kind]);
}

/** "24 hours", "1 hour" — so an email can never promise a window the server does not keep. */
export function describeTtl(kind: CredentialTokenKind): string {
  const minutes = Math.round(TOKEN_TTL_MS[kind] / 60_000);
  if (minutes % 60 !== 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
