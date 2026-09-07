import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';

import { env, isProd } from './config/env';
import { sanitizeRequest } from './middleware/sanitize';
import apiRoutes from './routes';
import { fail } from './utils/http';

/**
 * CORS allow-list. Always permits the configured frontend and requests with no
 * Origin (curl, server-to-server). In development it also accepts any
 * http://localhost:<port>, so the app still works if Next starts on 3001/3002
 * because 3000 was taken. Production is strict.
 */
function corsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || origin === env.frontendUrl) return cb(null, true);
  if (!isProd && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
  cb(new Error('Not allowed by CORS'));
}

/**
 * Builds the Express app without connecting to Mongo or binding a port, so it
 * can be imported by both the server bootstrap (index.ts) and the verify
 * script / tests.
 */
export function createApp(): Application {
  const app = express();

  /**
   * Security headers.
   *
   * This process serves JSON to a separate origin, never HTML, so most of
   * helmet's defaults are belt-and-braces — but a header costs nothing and an
   * API that starts serving an error page, a redirect or an uploaded file later
   * is exactly when they stop being theoretical.
   *
   * The CSP is deliberately near-total denial: nothing legitimate is ever loaded
   * *from* this origin, so anything the browser is told to fetch from a response
   * of ours is by definition not something we meant to send.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          sandbox: ['allow-scripts'],
        },
      },
      // Deny framing outright rather than same-origin: nothing here should ever
      // render in a frame.
      frameguard: { action: 'deny' },
      // Never leak a path or query string to a third party.
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Only meaningful over HTTPS; harmless on localhost, and a deployment
      // that forgets it is one downgrade away from a stolen bearer token.
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      // Stops a sniffed response being treated as script.
      noSniff: true,
      xPoweredBy: true,
    }),
  );

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  // 8MB: profile photos arrive as base64 data URLs on a JSON body, and base64
  // inflates by about a third. The upload service caps the string itself.
  app.use(express.json({ limit: '8mb' }));

  // After the body parser and before any route: by the time a handler runs, no
  // key in body, query or params can be a Mongo operator.
  app.use(sanitizeRequest);

  /**
   * Liveness, on both paths.
   *
   * `/health` is unprefixed because a platform healthcheck is not an API call
   * and should not have to know the API's mount point; `/api/health` predates
   * it and stays so nothing that already polls it breaks.
   *
   * Neither touches Mongo, deliberately. A healthcheck that queries the
   * database conflates "this process is alive" with "its dependencies are
   * reachable" — and the platform's response to a failed check is to kill and
   * restart the container, which is precisely the wrong move during a database
   * blip. The process is up; that is what this reports.
   */
  const health = (_req: Request, res: Response) => {
    res.json({ data: { status: 'ok', service: 'velvet-api' } });
  };

  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api', apiRoutes);

  // Unknown route → consistent error envelope.
  app.use((_req, res) => {
    fail(res, 'Not found', 404);
  });

  // Last-resort error handler — keeps the { error } contract even on throws.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('unhandled error:', err);
    fail(res, 'Something went wrong', 500);
  });

  return app;
}
