#!/bin/bash
# GB STUDY — VPS start script

cd "$(dirname "$0")"

PORT=${PORT:-3001}
NEXUS_PORT=${NEXUS_PORT:-5055}

echo "=== GB STUDY Deploy ==="

# Pehle sab purane processes band karo
echo "[1/4] Purane processes band kar rahe hain..."
pkill -f "nexus-gateway" 2>/dev/null
pkill -f "tsx server" 2>/dev/null
lsof -t -i:$NEXUS_PORT | xargs kill -9 2>/dev/null
lsof -t -i:$PORT | xargs kill -9 2>/dev/null
sleep 2

# Dependencies install (agar node_modules nahi hai)
if [ ! -d "node_modules" ]; then
  echo "[2/4] npm install kar rahe hain..."
  npm install --legacy-peer-deps
else
  echo "[2/4] node_modules already hai, skip."
fi

# Build (agar dist nahi hai)
if [ ! -d "dist" ]; then
  echo "[3/4] Build kar rahe hain..."
  VITE_CONFIG_NATIVE_IGNORE_WARNING=true npm run build
else
  echo "[3/4] dist already hai, skip. (Force rebuild ke liye: rm -rf dist)"
fi

# Nexus gateway start karo
echo "[4/4] Services start kar rahe hain..."
NEXUS_PORT=$NEXUS_PORT screen -S nexus -dm bash -c "NEXUS_PORT=$NEXUS_PORT tsx nexus-gateway.ts; exec bash"
sleep 4

# Gateway check
AG=$(curl -s http://localhost:$NEXUS_PORT/cookie 2>/dev/null | grep -o '"ag":"[^"]*"' | head -1)
if [ -n "$AG" ]; then
  echo "✅ Nexus gateway: ag cookie mili!"
else
  echo "⚠  Nexus gateway: ag abhi fetch ho rahi hai (background mein chal rahi hai)"
fi

# Main server start karo
NODE_ENV=production PORT=$PORT screen -S gbstudy -dm bash -c "NODE_ENV=production PORT=$PORT tsx server.ts; exec bash"
sleep 2

echo ""
echo "=== Status ==="
screen -ls
echo ""
echo "✅ Site: http://$(hostname -I | awk '{print $1}'):$PORT"
echo "✅ Gateway: http://localhost:$NEXUS_PORT/status"
echo ""
echo "Logs dekhne ke liye:"
echo "  screen -r nexus    (Ctrl+A,D se bahar aao)"
echo "  screen -r gbstudy  (Ctrl+A,D se bahar aao)"
