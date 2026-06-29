#!/bin/bash
# SessionStart hook — install pinned deps so lint / typecheck / svelte-check / unit tests / the Vite
# build / Playwright e2e all work in a fresh Claude Code on the web session. Synchronous: the session
# waits until deps are ready, avoiding a race where the agent runs `npm test` before node_modules exist.
set -euo pipefail

# Web (remote) only — local developers manage their own node_modules and shouldn't have this run on them.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm install` (not `npm ci`) so a CACHED web container does a fast incremental install instead of
# wiping node_modules each session. Idempotent; the committed lockfile keeps it reproducible.
npm install --no-audit --no-fund

# NOTE: Playwright's Chromium is PRE-INSTALLED in the web environment (PLAYWRIGHT_BROWSERS_PATH=
# /opt/pw-browsers, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), so `npm run test:e2e` works without an
# explicit `npx playwright install` here — adding one would be a no-op (the download is skipped).
