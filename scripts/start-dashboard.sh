#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Ruflo Command — one-command launcher.
# Installs deps (first run) and starts both services:
#   - ruflow-ui backend      :3001  (memory/agents/learning/system API + WS)
#   - ruflow-dashboard        :3002  (the dashboard — open this one)
# Ctrl-C stops both. Override ports with PORT / DASHBOARD_PORT.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_PORT="${PORT:-3001}"
DASH_PORT="${DASHBOARD_PORT:-3002}"

echo "==> Installing dependencies (first run only)…"
(cd "$ROOT/ruflow-ui" && npm install --no-audit --no-fund --silent)
(cd "$ROOT/ruflow-dashboard" && npm install --no-audit --no-fund --silent)

echo "==> Starting ruflow-ui backend on :$UI_PORT"
(cd "$ROOT/ruflow-ui" && PORT="$UI_PORT" node server.js) &
UI_PID=$!

echo "==> Starting dashboard on :$DASH_PORT"
(cd "$ROOT/ruflow-dashboard" && DASHBOARD_PORT="$DASH_PORT" RUFLOW_UI_URL="http://localhost:$UI_PORT" node server.js) &
DASH_PID=$!

cleanup() { echo; echo "==> Stopping…"; kill "$UI_PID" "$DASH_PID" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

echo
echo "  Ruflo Command is up →  http://localhost:$DASH_PORT"
echo "  (Ctrl-C to stop both services)"
echo
wait
