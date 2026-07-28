import type { AuthTokenPayload } from '../utils/jwt';

// Augment Express's Request so `req.user` is typed after requireAuth runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export {};
