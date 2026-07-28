# Velvet API

Express + TypeScript + MongoDB (Mongoose) backend for Velvet. Currently ships
authentication; catalog / social / AI endpoints follow the roadmap.

## Run it

```bash
cd backend
npm install
cp .env.example .env      # then edit .env
npm run dev               # http://localhost:4000
```

Set these in `backend/.env`:

| Var           | What                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `JWT_SECRET`  | Secret for signing JWTs. Use a long random string in production.     |
| `MONGODB_URI` | MongoDB Atlas connection string (Atlas → Connect → Drivers).         |
| `FRONTEND_URL`| Frontend origin for CORS. Default `http://localhost:3000`.           |
| `PORT`        | API port. Default `4000` — must match the frontend's `NEXT_PUBLIC_API_URL`. |

The server refuses to start without `MONGODB_URI`, and in production refuses the
insecure default `JWT_SECRET`.

## Verify without a database

```bash
npm run verify
```

Spins up an **in-memory MongoDB** and drives the real Express app end-to-end
(register → login → me plus every failure mode) — no Atlas string needed. Use it
to confirm the auth flow after any change.

## Endpoints

| Method | Path                 | Auth | Body / returns                                             |
| ------ | -------------------- | ---- | ---------------------------------------------------------- |
| POST   | `/api/auth/register` | —    | `{ email, username, displayName, password }` → `{ token, user }` |
| POST   | `/api/auth/login`    | —    | `{ email, password }` → `{ token, user }`                  |
| GET    | `/api/auth/me`       | JWT  | → `{ user }`                                               |
| GET    | `/api/health`        | —    | → `{ status }`                                             |

Contract: success → `{ "data": ... }`, error → `{ "error": "message" }`.
Auth is a Bearer JWT: `Authorization: Bearer <token>`, valid 7 days.
`passwordHash` is never returned by any endpoint.

## Layout

```
src/
  index.ts               bootstrap: env checks → Mongo connect → listen
  app.ts                 Express app (no listen) — imported by index + verify
  config/env.ts          typed environment
  lib/db.ts              Mongoose connect/disconnect
  models/User.ts         User schema + IUser interface
  middleware/auth.ts     requireAuth — verifies Bearer JWT → req.user
  controllers/authController.ts   register / login / me
  routes/auth.ts         routes + rate limiter
  utils/                 jwt, http envelopes, validators
scripts/verify-auth.ts   in-memory end-to-end check
```
