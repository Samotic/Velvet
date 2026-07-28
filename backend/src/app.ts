import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';

import { env, isProd } from './config/env';
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

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  // 8MB: profile photos arrive as base64 data URLs on a JSON body, and base64
  // inflates by about a third. The upload service caps the string itself.
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', service: 'velvet-api' } });
  });

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
