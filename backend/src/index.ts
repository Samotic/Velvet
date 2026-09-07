import { createServer } from 'node:http';

import { createApp } from './app';
import { configured, env, isProd } from './config/env';
import { activeProvider } from './lib/ai';
import { connectDb } from './lib/db';
import { initSocket } from './lib/socket';

/** Server bootstrap: fail fast on misconfiguration, connect Mongo, then listen. */
async function main() {
  // In production a real secret is mandatory — never ship the dev fallback.
  if (isProd && env.jwtSecret === 'velvet_dev_insecure_secret_change_me') {
    console.error('FATAL: JWT_SECRET must be set in production.');
    process.exit(1);
  }

  if (!env.mongoUri) {
    console.error(
      'FATAL: MONGODB_URI is not set. Copy backend/.env.example to backend/.env and add your Atlas string.',
    );
    process.exit(1);
  }

  try {
    await connectDb(env.mongoUri);
  } catch (err) {
    console.error('FATAL: could not connect to MongoDB:', err);
    process.exit(1);
  }

  const app = createApp();

  // Socket.io shares the HTTP server, so messaging and the REST API sit on one
  // port behind one CORS policy.
  const server = createServer(app);
  initSocket(server);

  /**
   * `0.0.0.0`, stated rather than left to Node's default.
   *
   * Node already binds every interface when the host is omitted, so this
   * changes no behaviour — but inside a container "which interface" is the
   * difference between a reachable service and one the platform's healthcheck
   * times out on, and a default that happens to be right is a poor thing to
   * rest a deploy on. `env.port` is `process.env.PORT` with a local fallback;
   * Railway injects that variable, so nothing here may hardcode 4000.
   */
  server.listen(env.port, '0.0.0.0', () => {
    console.log(`✓ Velvet API listening on 0.0.0.0:${env.port}`);
    console.log(`  CORS allow-origin: ${env.frontendUrl}`);

    // Every third-party integration is optional; say plainly which are live so
    // a missing key is obvious at boot rather than as a 503 hours later.
    const status = (name: string, on: boolean) => `${on ? '✓' : '·'} ${name}`;
    console.log(
      `  ${[
        status('TMDB', configured.tmdb()),
        status('IGDB', configured.igdb()),
        // Named for whichever provider the flag selected, so a boot line never
        // claims the advisor is live on a key the active provider cannot use.
        status(activeProvider === 'gemini' ? 'Gemini' : 'Claude', configured.ai()),
        status('Cloudinary', configured.cloudinary()),
        status('Google', configured.google()),
        status('Email', configured.email()),
      ].join('   ')}`,
    );
  });
}

main();
