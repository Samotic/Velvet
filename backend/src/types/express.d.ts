import type { AuthTokenPayload } from '../utils/jwt';

// Augment Express's Request so `req.user` is typed after requireAuth runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
      /**
       * Fields `requireAuth` already read from the user document, passed
       * forward so downstream middleware need not fetch the same row again.
       */
      authUser?: { emailVerified: boolean };
    }
  }
}

export {};
