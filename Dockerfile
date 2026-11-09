# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN npm ci && npm --prefix frontend ci

# Ensure yt-dlp binary is present and executable (without runtime --update)
RUN if [ ! -s node_modules/@distube/yt-dlp/bin/yt-dlp ]; then \
      CI=false node node_modules/@distube/yt-dlp/script/download.js; \
    fi \
  && chmod 0755 node_modules/@distube/yt-dlp/bin/yt-dlp

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY frontend ./frontend

RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    YTDLP_DISABLE_DOWNLOAD=1 \
    FFMPEG_PATH=/usr/bin/ffmpeg

WORKDIR /app

RUN mkdir -p /app/data /app/logs && chown -R node:node /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/frontend/dist ./frontend/dist
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations

USER node

# Verify yt-dlp and the Debian FFmpeg work as non-root user without --update
RUN node -e "const { execFileSync } = require('node:child_process'); const path = require('node:path'); const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static'); const ytdlp = path.join(path.dirname(require.resolve('@distube/yt-dlp')), '..', 'bin', 'yt-dlp'); execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); execFileSync(ytdlp, ['--version'], { stdio: 'ignore' });"

RUN node scripts/check-ffmpeg.cjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.WEB_PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "scripts/supervise.cjs"]
