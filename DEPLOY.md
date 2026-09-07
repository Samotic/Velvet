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

| Variable | Required | Where the value comes from |
| --- | --- | --- |
| `MONGODB_URI` | **Boot fails without it** | Atlas → Database → Connect → Drivers. Include the database name. |
| `JWT_SECRET` | **Boot fails on the dev default** | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Changing it later signs every existing session out. |
| `FRONTEND_URL` | **Boot fails in production** | The Vercel URL, no trailing slash. It is the CORS allow-list *and* the Socket.io origin. |
| `API_URL` | **Boot fails if Google is configured and `GOOGLE_CALLBACK_URL` is not** | This service's own Railway URL. Only ever read to build the Google callback. |
| `PORT` | **Do not set** | Railway injects it. Setting it pins the server to a port the platform is not routing to, and the healthcheck fails on a process that is running fine. |
| `NODE_ENV` | Set for you | The Dockerfile sets `production`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application). Without them the button hides and the routes 503. |
| `GOOGLE_CALLBACK_URL` | Optional | The **exact** Authorised redirect URI registered with Google. Compared byte for byte — a trailing slash or `http` vs `https` is a failed sign-in, not a warning. Set this *or* `API_URL`. |
| `GEMINI_API_KEY` | Optional | aistudio.google.com/apikey. Without it the advisor answers 503. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | Optional | cloudinary.com/console → Dashboard. Without them photos and voice notes are refused politely; text messaging still works. |
| `TMDB_READ_TOKEN` *or* `TMDB_API_KEY` | Optional | themoviedb.org/settings/api. Without one, films and series are empty. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Optional | dev.twitch.tv/console/apps. Without them, Games is empty. |
| `RESEND_API_KEY` | Optional | resend.com → API Keys. Without it every send is a logged no-op — registration works, verification cannot. |
| `EMAIL_FROM` | Optional | A domain verified in Resend. |
| `AI_FREE_DAILY_MESSAGES` | Optional, default 25 | The only bound on your model bill. A voice question costs two calls against one message. |
| `MEDIA_DESTROY_DRYRUN` | **Do not set** | Debug only. Left on, retracted photos and voice notes are never deleted from Cloudinary. |
| `SUPPORTS_TRANSACTIONS` | Leave unset | Defaults true, correct for Atlas. Only `false` against a standalone `mongod`. |

Healthcheck path: **`/health`** — returns 200 and deliberately does not touch
Mongo, so a database blip does not get the container restarted.

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
5. **The migration**, once you have confirmed the API is talking to the
   production database. It is not in the image — `scripts/` is excluded — so run
   it from a machine holding the production `MONGODB_URI`:

   ```bash
   cd backend && npx tsx scripts/migrate-message-soft-delete.ts --dry
   cd backend && npx tsx scripts/migrate-message-soft-delete.ts
   ```

---

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
