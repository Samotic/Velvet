# Deploying Velvet

Two services: the Express API on **Railway** (root directory `/backend`), the
Next.js app on **Vercel** (project root = repo root). No `vercel.json` — Vercel
detects Next from `package.json`, and a config file would be one more thing
able to disagree with the framework.

Deploy the API first. Its public URL is an input to the frontend build.

---

## The variables that decide whether it boots

Four of these are enforced. The server exits with a `FATAL:` line rather than
starting into a broken state, and the frontend build fails rather than
publishing an app that cannot reach its API. Everything else degrades politely:
a missing integration key means the routes that need it answer 503 with a
readable message, and the boot log prints which are live.

### Railway — the API

Healthcheck path: **`/health`** — returns 200 and deliberately does not touch
Mongo, so a database blip does not get the container restarted.

#### Must be set — the server exits without them

| Variable | Where the value comes from | If missing |
| --- | --- | --- |
| `MONGODB_URI` | Atlas → Database → Connect → Drivers. Include the database name in the path. | `FATAL` at boot. |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | `FATAL` at boot if left on the dev default. Changing it later signs every existing session out. |
| `FRONTEND_URL` | The Vercel URL, no trailing slash. | `FATAL` at boot. It is the CORS allow-list *and* the Socket.io origin — wrong, and every browser request is blocked while the API looks healthy. |
| `API_URL` | This service's own Railway URL. | `FATAL` at boot **only if** Google credentials are set and `GOOGLE_CALLBACK_URL` is not. Its sole use is building the Google callback. |

#### Must NOT be set

| Variable | Why |
| --- | --- |
| `PORT` | Railway injects it. Setting it pins the server to a port the platform is not routing to, so the healthcheck fails on a process that is running fine. |
| `MEDIA_DESTROY_DRYRUN` | Debug only. Left on, retracted photos and voice notes are never actually deleted from Cloudinary. |
| `NODE_ENV` | The Dockerfile already sets `production`. |

#### Optional — each one degrades a single feature

Nothing here stops the app booting. A missing key means the routes that need it
answer **503 with a readable message**, and the boot log prints which
integrations are live.

| Variable | Where the value comes from | If missing |
| --- | --- | --- |
| `TMDB_READ_TOKEN` | themoviedb.org/settings/api → "API Read Access Token" (long `eyJ…`). Preferred over the v3 key; if both are set this one wins. | Films and series are empty everywhere — home, search, detail pages. The advisor also cannot resolve `[[Title]]` links. |
| `TMDB_API_KEY` | Same page, "API Key" (32-char hex). Only needed if you are not using the token above. | As above, if the token is also absent. |
| `IGDB_CLIENT_ID` | dev.twitch.tv/console/apps → your app's Client ID. | The Games tab is empty. Films and series are unaffected. |
| `IGDB_CLIENT_SECRET` | Same app → Client Secret. | As above — both are needed together. |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | The advisor answers 503 with a "not configured" state. Voice questions fail too, since transcription runs through the same provider. |
| `GEMINI_MODEL` | Defaults to `gemini-3.6-flash`. Pin an exact model, never a `-latest` alias. | Falls back to the default. Note this repo currently runs `gemini-3.7-flash` — set it explicitly to match. |
| `AI_PROVIDER` | `gemini` (default) or `anthropic`. Anything unrecognised resolves to Gemini. | Defaults to Gemini. |
| `ANTHROPIC_API_KEY` | console.anthropic.com. Only read when `AI_PROVIDER=anthropic`. | Nothing, unless you switched the provider — then the advisor is 503. |
| `ANTHROPIC_MODEL` | Defaults to `claude-sonnet-4-6`. Only read when `AI_PROVIDER=anthropic`. | Falls back to the default. |
| `AI_FREE_DAILY_MESSAGES` | A number. Defaults to **25**. | Defaults to 25. This is the only bound on your model bill — Velvet has no paid tier. A voice question costs two calls against one message. |
| `CLOUDINARY_CLOUD_NAME` | cloudinary.com/console → Dashboard. | Profile photos, message photos and voice notes are all refused politely (503). Text messaging still works. All three Cloudinary values are needed together. |
| `CLOUDINARY_API_KEY` | Same dashboard. | As above. |
| `CLOUDINARY_API_SECRET` | Same dashboard — reveal it, it is hidden by default. | As above. |
| `GOOGLE_CLIENT_ID` | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application). | The "Continue with Google" button hides itself and the OAuth routes 503. Email/password sign-in is unaffected. |
| `GOOGLE_CLIENT_SECRET` | Same credential. | As above — both are needed together. |
| `GOOGLE_CALLBACK_URL` | The **exact** Authorised redirect URI you registered with Google, e.g. `https://your-api.up.railway.app/api/auth/google/callback`. | Derived from `API_URL` instead. Google compares byte for byte, so a trailing slash or `http` vs `https` is a failed sign-in, not a warning. |
| `GOOGLE_REDIRECT_URI` | An alias for the row above, for consoles set up under that name. `GOOGLE_CALLBACK_URL` wins when both are present. | Nothing, if `GOOGLE_CALLBACK_URL` or `API_URL` is set. |
| `RESEND_API_KEY` | resend.com → API Keys. | Every email becomes a logged no-op. Registration still works, but nobody can verify an address — which gates the advisor and messaging. |
| `EMAIL_FROM` | A domain verified in Resend, e.g. `Velvet <noreply@yourdomain.com>`. | Falls back to Resend's shared sender, which only delivers to the address owning the Resend account. Fine for testing, useless for real users. |
| `SUPPORTS_TRANSACTIONS` | Leave unset. | Defaults to `true`, which is correct for Atlas — it is a replica set. Set `false` only against a standalone `mongod`, where every transaction throws. |

### Vercel — the frontend

| Variable | Required | Where the value comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Build fails without it** | The Railway URL, no trailing slash. |

That is the whole list. The frontend holds no third-party secrets; the browser
reaches every integration through the API.

`NEXT_PUBLIC_*` is inlined at **build** time, not read at runtime. Changing it
in the dashboard does nothing until you redeploy, and a stale value can survive
in the build cache — if you change it, redeploy without the cache.

---

## Order

1. **Railway.** Root directory `/backend`, region EU West. It builds from
   `backend/Dockerfile` — an explicit Dockerfile rather than nixpacks, so the
   Node version is a decision in the repo instead of something inferred. Set
   `MONGODB_URI`, `JWT_SECRET`, and any optional keys. `FRONTEND_URL` does not
   exist yet, so put a placeholder such as `https://example.invalid` to get the
   first boot through, or deploy after step 2 and set it properly.
2. **Vercel.** Import the repo, leave the framework preset alone, set
   `NEXT_PUBLIC_API_URL` to the Railway URL from step 1. Deploy.
3. **Back to Railway.** Set `FRONTEND_URL` to the Vercel URL and redeploy.
   Until this is right, the browser cannot call the API at all.
4. **Google**, if used. Add `https://<railway-url>/api/auth/google/callback` to
   the Authorised redirect URIs, then set `GOOGLE_CALLBACK_URL` to that exact
   string, or set `API_URL` and let it be derived.
5. **The index migration.** Indexes are no longer built on boot in production
   — `autoIndex` is off, because Mongoose cannot change an existing index and
   fails silently when it tries, leaving the schema and the database
   disagreeing. Run it from a machine holding the production `MONGODB_URI`:

   ```bash
   cd backend && npx tsx scripts/migrate-notification-index.ts --dry
   cd backend && npx tsx scripts/migrate-notification-index.ts
   ```

   It is idempotent — it inspects the live index and does nothing if the swap
   has already happened. **From here on, any index change is a script**, not a
   schema edit: an edit alone will not take effect in production.

6. **The soft-delete migration**, once you have confirmed the API is talking to the
   production database. It is not in the image — `scripts/` is excluded — so run
   it from a machine holding the production `MONGODB_URI`:

   ```bash
   cd backend && npx tsx scripts/migrate-message-soft-delete.ts --dry
   cd backend && npx tsx scripts/migrate-message-soft-delete.ts
   ```

---

## Proxy hops — read this before putting anything in front of Railway

`backend/src/app.ts` sets **`app.set('trust proxy', 1)`**. It is a code
constant, not an environment variable, and it encodes an assumption about your
hosting that will not announce itself when it stops being true.

**Why it exists.** Every request on Railway arrives through the platform's
edge. Without this, `req.ip` is the *proxy's* address for every caller alike,
so every IP-keyed rate limiter shares one bucket — the auth limiter's 50
attempts per 15 minutes becomes 50 for the entire internet, and the first burst
of real traffic locks everyone out of signing in. It reads as an outage, not as
a limiter working.

**Why `1` and not `true`.** `true` trusts the whole `X-Forwarded-For` chain,
which the client writes. An attacker could then put any address at the front
and step around every limit by rotating a header. `1` trusts the platform edge
and nothing beyond it.

**When you must change it.** The number is the count of proxies in front of
this service. Put a CDN or another reverse proxy ahead of Railway —
Cloudflare, a custom domain proxy, an API gateway — and there are two hops, so
it must become `2`. Leave it at `1` and the limiters start keying on the CDN's
address instead of the visitor's: everyone shares a bucket again, and the
symptom is the same false lockout as having no setting at all.

**Nothing will tell you.** There is no error and no log line for this — the
limiters simply key on the wrong thing. If you add a layer in front, change
the number in the same commit.

## HTTPS is not optional

Voice notes and the advisor's microphone use `getUserMedia`, which browsers
refuse outside a secure context. Over plain `http` the microphone button hides
itself and the feature silently does not exist. Vercel and Railway both serve
https by default; the thing to avoid is testing over a LAN IP and concluding
the feature is broken.

---

## Known limits at the time of writing

- Message photos and voice notes are public-read on the Cloudinary CDN. The
  URLs are unguessable but not behind the login.
- Direct messages are stored as plaintext in Mongo. There is no end-to-end
  encryption; anyone with database access can read them.
- Signing out clears the token in the browser but does not revoke it
  server-side. A copied token stays valid until it expires (7 days).
