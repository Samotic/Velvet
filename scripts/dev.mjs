import { connect, createServer } from 'node:net';
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

/**
 * Why a bind test alone cannot answer "is 3000 free".
 *
 * The probe used to bind `0.0.0.0` and treat success as free, while Next binds
 * `::`. Measured on Windows with Node 24: a dual-stack `[::]:3000` bind — the
 * one Next makes — *succeeds* beside an existing listener on IPv6-only `[::]`,
 * on `[::1]`, on `127.0.0.1`, and even on `0.0.0.0`. The OS lets the sockets
 * share the port instead of refusing, so Next does not fall back to 3001 at
 * all. It starts, and `localhost` splits: whichever loopback address the other
 * process holds keeps reaching that process, so the browser gets Velvet or the
 * stranger depending on which address it tried first. A bind test collides
 * only with a listener on the very same address, so it misses most of these.
 *
 * So there are two checks, and the port is taken if either finds something:
 *
 *  - **Something answers a connection on `::1` or `127.0.0.1`.** This is the
 *    check that catches the cases above — in every one, the other listener
 *    accepted on at least one loopback — and on loopback a connection is
 *    accepted or refused immediately.
 *  - **A bind on `::`, `0.0.0.0`, `::1` or `127.0.0.1` is refused.** Kept for
 *    platforms that do refuse overlapping binds, where a listener on some other
 *    address (a LAN IP, say) makes Next's own bind fail and fall back.
 *
 * The binds run only when nothing answered: on a platform that lets them
 * overlap, a probe opened beside a live server could take its connections for
 * the moment it is open. Sequential, because each bind briefly holds the port.
 */
const LOOPBACKS = ['::1', '127.0.0.1'];
const BIND_HOSTS = ['::', '0.0.0.0', '::1', '127.0.0.1'];

const label = (host) => (host.includes(':') ? `[${host}]:${PORT}` : `${host}:${PORT}`);

/** Whether something on `host` accepts a connection to `port`. */
function answers(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    // Loopback accepts or refuses at once; the timeout only guards a machine
    // where it does neither.
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Whether a bind on `host` is refused because the port is in use. Only
 * EADDRINUSE counts, as before: an address this machine does not have (IPv6
 * disabled) is nothing to check, and any other bind error is left for Next to
 * report in its own words.
 */
function bindRefused(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen({ port, host });
  });
}

const found = [];
for (const host of LOOPBACKS) {
  if (await answers(PORT, host)) found.push(`answering on ${label(host)}`);
}
if (!found.length) {
  for (const host of BIND_HOSTS) {
    if (await bindRefused(PORT, host)) found.push(`bind refused on ${label(host)}`);
  }
}

if (found.length) {
  console.error(`\n\x1b[31m✗ Port ${PORT} is already in use\x1b[0m (${found.join('; ')}).`);
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
