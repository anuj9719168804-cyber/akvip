#!/bin/bash
# GB STUDY — Safe restart (port kill + git pull + start)
set -e
cd "$(dirname "$0")"

PORT=${PORT:-3000}
NEXUS_PORT=${NEXUS_PORT:-5055}

echo "=== GB STUDY Restart ==="
echo ""

# ── 1. Ports khali karo ──────────────────────────────────────
echo "[1/5] Ports $PORT + $NEXUS_PORT khali kar rahe hain..."
lsof -ti:$PORT  | xargs kill -9 2>/dev/null && echo "  ✓ Port $PORT kill" || echo "  - Port $PORT already free"
lsof -ti:$NEXUS_PORT | xargs kill -9 2>/dev/null && echo "  ✓ Port $NEXUS_PORT kill" || echo "  - Port $NEXUS_PORT already free"
pkill -f "tsx server" 2>/dev/null || true
pkill -f "nexus-gateway" 2>/dev/null || true
sleep 1

# ── 2. Git — stash, pull, pop ────────────────────────────────
echo ""
echo "[2/5] Git update kar rahe hain..."
if git status --porcelain | grep -q "server.ts\|BatchDetailView\|start.sh"; then
  echo "  Local changes detected — stash kar rahe hain..."
  git stash push -m "auto-stash before restart $(date '+%H:%M:%S')" \
    -- server.ts src/components/BatchDetailView.tsx start.sh 2>/dev/null || true
  STASHED=1
else
  STASHED=0
fi

git pull origin main 2>&1 | tail -3 || echo "  (git pull skip — already up to date)"

if [ "$STASHED" = "1" ]; then
  echo "  Local changes wapas laa rahe hain..."
  git stash pop 2>/dev/null || echo "  ⚠  Stash pop conflict — manual check karo: git stash show"
fi

# ── 3. Dependencies ──────────────────────────────────────────
echo ""
echo "[3/5] Dependencies check..."
if [ ! -d "node_modules" ]; then
  echo "  npm install..."
  npm install --legacy-peer-deps --silent
else
  echo "  node_modules OK"
fi

# ── 4. Build (production mode mein) ─────────────────────────
echo ""
echo "[4/5] Build check..."
if [ "${NODE_ENV}" = "production" ] && [ ! -d "dist" ]; then
  echo "  Building..."
  npm run build 2>&1 | tail -5
else
  echo "  Dev mode — build skip"
fi

# ── 5. Start ─────────────────────────────────────────────────
echo ""
echo "[5/5] Server start kar rahe hain..."
echo ""

if [ "${NODE_ENV}" = "production" ]; then
  NODE_ENV=production PORT=$PORT NEXUS_PORT=$NEXUS_PORT tsx server.ts &
  SERVER_PID=$!
else
  PORT=$PORT NEXUS_PORT=$NEXUS_PORT npm run dev &
  SERVER_PID=$!
fi

# Gateway warm-up ka wait
echo "Waiting for gateway to start (15s)..."
sleep 15

# Health check
AG_RESP=$(curl -s --max-time 5 "http://localhost:$PORT/nexus/ag" 2>/dev/null || echo "{}")
AG_VAL=$(echo "$AG_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ag','')[:40])" 2>/dev/null || echo "")

echo ""
echo "=== Status ==="
if [ -n "$AG_VAL" ]; then
  echo "✅ Server: http://localhost:$PORT"
  echo "✅ Gateway: ag cookie ready (${AG_VAL}...)"
  echo ""
  echo "Test karo:"
  echo "  AG=\$(curl -s http://localhost:$PORT/nexus/ag | python3 -c \"import sys,json; print(json.load(sys.stdin)['ag'])\")"
  echo "  curl -s \"http://localhost:$PORT/api/video-url?batch_id=69897f0a4c12aeb013d4ea52&subject_id=physical-chemistry-435878&video_id=69e099169d5176e462666029\""
else
  echo "⚠  Server chal raha hai lekin ag abhi fetch ho rahi hai"
  echo "   Thodi der mein check karo:"
  echo "   curl http://localhost:$PORT/nexus/ag"
  echo "   curl http://localhost:$PORT/nexus/status"
fi

wait $SERVER_PID
