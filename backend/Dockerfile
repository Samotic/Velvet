# Velvet API — Railway, root directory /backend.
#
# An explicit Dockerfile rather than nixpacks: nixpacks infers a Node version
# from whatever it can find, and this project has no `engines` field, so the
# version it picks can change under you between deploys. A pinned base image
# means the runtime is a decision recorded in the repo.
#
# `22-slim` pins the major line — the part that actually decides whether the
# code runs — while still taking patch and security updates on rebuild. Pinning
# an exact patch would freeze known CVEs in place until someone remembered to
# bump it. Debian slim rather than alpine: nothing here needs native
# compilation (bcryptjs is pure JS), so alpine's musl buys a smaller image at
# the cost of a class of subtle runtime differences that are miserable to debug
# on a platform you cannot attach a shell to quickly.

# ---------------------------------------------------------------- build stage
FROM node:22-slim AS build

WORKDIR /app

# Manifests first, on their own layer: dependencies only reinstall when they
# actually change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# tsconfig.build.json excludes *.test.ts, so `dist` is product only.
RUN npm run build

# -------------------------------------------------------------- runtime stage
FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# `--omit=dev` here and not in the build stage: typescript and tsx are needed
# to compile and are dead weight afterwards. The compiled output has no idea
# they ever existed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The image ships no `.env`. Every value comes from the Railway dashboard —
# see .env.example for the full list.

# Drop root. The `node` user ships with the base image and owns nothing it
# does not need; the app only ever reads its own compiled output.
USER node

# Documentation only. Railway injects PORT and the server reads it — see
# `env.port`. Nothing in the image hardcodes a port.
EXPOSE 4000

# Node directly, not `npm start`: npm adds a process between the platform and
# the server that swallows signals, so a container stop becomes a 10-second
# wait for SIGKILL instead of a clean exit.
CMD ["node", "dist/index.js"]
