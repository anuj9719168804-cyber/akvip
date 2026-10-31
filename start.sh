#!/bin/bash
# GB STUDY — VPS start script

cd "$(dirname "$0")"

PORT=${PORT:-3001}
NEXUS_PORT=${NEXUS_PORT:-5055}

echo "=== GB STUDY Deploy ==="

# Pehle sab purane processes band karo
echo "[1/3] Purane processes band kar rahe hain..."
pkill -f "nexus-gateway" 2>/dev/null
pkill -f "tsx server" 2>/dev/null
lsof -t -i:$NEXUS_PORT | xargs kill -9 2>/dev/null
lsof -t -i:$PORT | xargs kill -9 2>/dev/null
sleep 2

# Dependencies install (agar node_modules nahi hai)
if [ ! -d "node_modules" ]; then
  echo "[2/3] npm install kar rahe hain..."
  npm install --legacy-peer-deps
else
  echo "[2/3] node_modules already hai, skip."
fi

# Build (agar dist nahi hai)
if [ ! -d "dist" ]; then
  echo "[3/3] Build kar rahe hain..."
  VITE_CONFIG_NATIVE_IGNORE_WARNING=true npm run build
else
  echo "[3/3] dist already hai, skip. (Force rebuild ke liye: rm -rf dist)"
fi

# NOTE: server.ts khud nexus-gateway ko andar se start karta hai (startGatewayChild)
# Isliye sirf ek screen chahiye — sirf server.ts
echo "Starting GB STUDY server (with embedded nexus gateway)..."
NODE_ENV=production PORT=$PORT NEXUS_PORT=$NEXUS_PORT screen -S gbstudy -dm bash -c \
  "NODE_ENV=production PORT=$PORT NEXUS_PORT=$NEXUS_PORT npx tsx server.ts 2>&1 | tee /tmp/gbstudy.log; exec bash"

sleep 5

echo ""
echo "=== Status ==="
screen -ls
echo ""
echo "✅ Site:    http://$(hostname -I | awk '{print $1}'):$PORT"
echo "✅ Gateway: http://localhost:$NEXUS_PORT/status"
echo "✅ Nexus AG: http://localhost:$NEXUS_PORT/cookie"
echo ""
echo "Logs dekhne ke liye:"
echo "  screen -r gbstudy      (Ctrl+A,D se bahar aao)"
echo "  tail -f /tmp/gbstudy.log"
