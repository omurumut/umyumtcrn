#!/bin/bash
set -e

cd /home/runner/workspace/Energy-Insights-Hub/Energy-Insights-Hub

# Build API server
echo "[start] Building API server..."
pnpm --filter @workspace/api-server run build

# Free port 8080 if in use
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

# Start API server in background
echo "[start] Starting API server on port 8080..."
PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs &
API_PID=$!

# Wait for API server to be ready
sleep 3

# Start Vite dev server on port 5000
echo "[start] Starting frontend dev server on port 5000..."
PORT=5000 BASE_PATH="/" pnpm --filter @workspace/ems-dashboard run dev &
VITE_PID=$!

# Trap signals to kill both processes
trap "kill $API_PID $VITE_PID 2>/dev/null" EXIT INT TERM

wait $VITE_PID
