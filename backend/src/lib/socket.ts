import type { Server as HttpServer } from 'node:http';

import { Server as IOServer, type Socket } from 'socket.io';

import { env, isProd } from '../config/env';
import { verifyToken } from '../utils/jwt';

/**
 * Socket.io, used for **text messaging and notification badges only**.
 *
 * Every connection authenticates with the same JWT the REST API uses, then
 * joins a room named after its user id. That's the whole routing model: to
 * reach a user, emit to `user:<id>`. It means a user with three tabs open gets
 * the event in all three, and no client can subscribe to someone else's room.
 */

let io: IOServer | null = null;

const roomFor = (userId: string) => `user:${userId}`;

/** Socket with the authenticated user attached by the handshake middleware. */
type AuthedSocket = Socket & { userId?: string };

export function initSocket(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || origin === env.frontendUrl) return cb(null, true);
        if (!isProd && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
  });

  // Handshake auth. The client passes the token in `auth.token`; a bad or
  // missing token refuses the connection rather than allowing an anonymous one.
  io.use((socket: AuthedSocket, next) => {
    const raw = socket.handshake.auth?.token;
    const token = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '').trim() : '';
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.userId = verifyToken(token).userId;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    const userId = socket.userId;
    if (!userId) return;

    void socket.join(roomFor(userId));

    /**
     * Typing indicator. Relayed straight to the recipient without persistence —
     * it's ephemeral by nature, and `userId` on the outgoing payload is taken
     * from the verified token rather than the client's payload, so a client
     * can't claim to be someone else typing.
     *
     * The event names match the client's (`typing:start` / `typing:stop`) so
     * the same string is used on both ends of the wire.
     */
    socket.on('typing:start', (payload: unknown) => {
      const to = readTo(payload);
      if (to) emitToUser(to, 'typing:start', { userId });
    });

    socket.on('typing:stop', (payload: unknown) => {
      const to = readTo(payload);
      if (to) emitToUser(to, 'typing:stop', { userId });
    });
  });

  return io;
}

function readTo(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const to = (payload as { to?: unknown }).to;
  return typeof to === 'string' && to ? to : null;
}

/** Pushes an event to every socket a user has open. No-op before initSocket. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(roomFor(userId)).emit(event, payload);
}
