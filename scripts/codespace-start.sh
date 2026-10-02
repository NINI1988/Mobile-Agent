#!/usr/bin/env bash
#
# Start the Mobile Agent server in a GitHub Codespace / dev container.
# Called by postStartCommand and by the "Mobile Agent: start" VS Code task.
#
# The server runs in the background and keeps agent sessions alive across
# phone disconnects. Its log is /tmp/mobile-agent.log. Run with --foreground
# to keep it attached to the terminal instead.
#
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-12000}"
LOG="/tmp/mobile-agent.log"

cd "$ROOT" || exit 1

# The '[s]' bracket keeps pgrep/pkill from matching this script's own command
# line, which would make the guard think the server is already running.
if pgrep -f '[s]erver/index.mjs' >/dev/null 2>&1; then
  echo "[mobile-agent] Server already running on port $PORT"
  exit 0
fi

if [ ! -d "$ROOT/dist-web" ]; then
  echo "[mobile-agent] No dist-web/ build found; building the web app…"
  npm run build:web || exit 1
fi

if [ "${1:-}" = "--foreground" ]; then
  echo "[mobile-agent] Starting server in the foreground on port $PORT"
  exec env PORT="$PORT" MOBILE_AGENT_OPEN=0 node server/index.mjs
fi

echo "[mobile-agent] Starting server in the background on port $PORT (log: $LOG)"
PORT="$PORT" MOBILE_AGENT_OPEN=0 nohup node server/index.mjs >>"$LOG" 2>&1 &

# Wait until the server answers, so the caller knows it is ready.
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "[mobile-agent] Server is ready: http://localhost:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "[mobile-agent] Server did not become ready — check $LOG" >&2
exit 1
