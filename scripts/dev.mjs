import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

/**
 * Starts Next on port 3000, or refuses to start at all.
 *
 * `next dev -p 3000` is not enough on its own: when the port is taken Next
 * prints "Port 3000 is in use, trying 3001 instead" and carries on. That
 * fallback is silent enough to miss and breaks things that cannot tolerate a
 * moving origin — Google matches redirect URIs byte for byte, and the backend's
 * FRONTEND_URL (which builds verification email links and is the CORS origin)
 * is pinned to 3000.
 *
 * So the port is probed first and the process exits non-zero with instructions
 * rather than drifting. Failing loudly is the entire point.
 */
const PORT = 3000;

function probe(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => resolve(err.code !== 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

const free = await probe(PORT);

if (!free) {
  console.error(`\n\x1b[31m✗ Port ${PORT} is already in use.\x1b[0m`);
  console.error(`\n  Velvet's dev server must run on ${PORT}. Nothing else will do:`);
  console.error(`    · Google rejects any redirect URI whose port differs`);
  console.error(`    · FRONTEND_URL builds the links in verification emails`);
  console.error(`    · the API's CORS layer allows that exact origin`);
  console.error(`\n  Free it, then run again:\n`);
  console.error(`    netstat -ano | findstr :${PORT}`);
  console.error(`    taskkill /PID <pid> /F\n`);
  process.exit(1);
}

// `shell: true` so the platform resolves the `next` binary from node_modules/.bin.
const child = spawn(`next dev -p ${PORT}`, { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
