#!/usr/bin/env bash
# Start all EcoScope services (bash/mac)
# - Backend with cron every 15 minutes
# - Wait for backend on port 5001
# - Optionally seed by running the scraper once
# - Frontend in dev mode
# - Logs to ./logs/*.log

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
LOGS_DIR="$REPO_ROOT/logs"

mkdir -p "$LOGS_DIR"

# Start backend with cron (SCRAPE_INTERVAL_MINUTES=15)
(
  export SCRAPE_INTERVAL_MINUTES=15
  cd "$BACKEND_DIR"
  echo "🚀 Starting Backend (cron interval 15m)..."
  npm run dev 2>&1 | tee -a "$LOGS_DIR/backend.log"
) &
BACKEND_PID=$!

echo "⏳ Waiting for backend on 127.0.0.1:5001 ..."
# Use local devDependency wait-on via npx
npx --yes wait-on tcp:127.0.0.1:5001 || {
  echo "❌ Backend did not start within the expected time. Check $LOGS_DIR/backend.log" >&2
  exit 1
}
echo "🟢 Backend is up on 127.0.0.1:5001"

# Seed once (optional): run scraper
(
  cd "$BACKEND_DIR"
  echo "🌱 Seeding: running scraper once..."
  npm run scrape 2>&1 | tee -a "$LOGS_DIR/scraper.log"
) &
SCRAPER_PID=$!

# Start frontend
(
  cd "$FRONTEND_DIR"
  echo "🎨 Starting Frontend (dev)..."
  npm run dev 2>&1 | tee -a "$LOGS_DIR/frontend.log"
) &
FRONTEND_PID=$!

echo "🟢 Tous les services sont lancés ! Backend (cron) + Frontend (dev)."
echo "UI: http://localhost:3000  |  API: http://127.0.0.1:5001/api/news"

echo "📜 Logs: $LOGS_DIR"

echo "ℹ️ Press Ctrl+C to stop (this will only stop this shell; background processes may continue)."
wait $BACKEND_PID $FRONTEND_PID || true
