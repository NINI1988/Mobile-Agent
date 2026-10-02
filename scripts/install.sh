#!/usr/bin/env bash
#
# Mobile Agent — one-shot installer for a dev container / Codespace.
#
# Installs Mobile Agent into a private directory, builds the web bundle,
# installs the Codex ACP agent, and starts the server pointed at the *current*
# workspace, so you can drive the project you are in from your phone browser.
# The server keeps running in the background after this script exits.
#
# Usage (from the root of any project's dev container):
#
#   curl -fsSL https://raw.githubusercontent.com/NINI1988/Mobile-Agent/main/scripts/install.sh | bash
#
# Environment overrides:
#   MOBILE_AGENT_REPO   git URL to clone            (default: this fork)
#   MOBILE_AGENT_REF    branch / tag                (default: main)
#   MOBILE_AGENT_DIR    install directory           (default: ~/.mobile-agent/app)
#   MOBILE_AGENT_CWD    workspace the agent edits   (default: current directory)
#   PORT                HTTP/WebSocket port         (default: 12000)
#   MOBILE_AGENT_AGENT  default agent id            (default: codex)
#
set -euo pipefail

REPO="${MOBILE_AGENT_REPO:-https://github.com/NINI1988/Mobile-Agent.git}"
REF="${MOBILE_AGENT_REF:-main}"
DIR="${MOBILE_AGENT_DIR:-$HOME/.mobile-agent/app}"
WORKSPACE="${MOBILE_AGENT_CWD:-$PWD}"
PORT="${PORT:-12000}"

log() { printf '\033[1;34m[mobile-agent]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[mobile-agent]\033[0m %s\n' "$*" >&2; }

if ! command -v node >/dev/null 2>&1; then
  err "Node.js 20+ is required but was not found."
  err "Install it (e.g. via your dev container's node feature) and re-run."
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  err "git is required but was not found."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ is required (found $(node -v))."
  exit 1
fi

log "Installing into $DIR (ref: $REF)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$REF"
  git -C "$DIR" checkout -q FETCH_HEAD
else
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 --branch "$REF" "$REPO" "$DIR"
fi

log "Installing dependencies"
( cd "$DIR" && npm install --no-audit --no-fund )

log "Building web app"
( cd "$DIR" && npm run build:web )

# Install the Codex ACP agent globally so sessions start instantly. Non-fatal:
# if it fails, the server falls back to `npx -y @agentclientprotocol/codex-acp`.
if command -v codex-acp >/dev/null 2>&1; then
  log "Codex ACP agent already installed"
else
  log "Installing Codex ACP agent (@agentclientprotocol/codex-acp)"
  npm install -g @agentclientprotocol/codex-acp@latest --no-audit --no-fund \
    || err "Could not install codex-acp globally; the server will use npx instead."
fi

# Stop a previous instance, if any.
if pgrep -f '[s]erver/index.mjs' >/dev/null 2>&1; then
  log "Stopping previous server"
  pkill -f '[s]erver/index.mjs' || true
  sleep 1
fi

log "Starting server on port $PORT (workspace: $WORKSPACE)"
cd "$DIR"
PORT="$PORT" MOBILE_AGENT_CWD="$WORKSPACE" MOBILE_AGENT_AGENT="${MOBILE_AGENT_AGENT:-codex}" \
  MOBILE_AGENT_OPEN=0 \
  nohup node server/index.mjs > /tmp/mobile-agent.log 2>&1 &

sleep 2
if pgrep -f '[s]erver/index.mjs' >/dev/null 2>&1; then
  log "Server started in the background — it keeps running after this script exits."
  log "Logs: /tmp/mobile-agent.log"
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    log "Open this URL on your phone (the Codespace Ports tab opens it automatically):"
    log "  https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  else
    log "Open: http://localhost:${PORT}"
  fi
  log "Codex is installed — sign in from the GUI (Authentication Required → device code)."
else
  err "Server failed to start — check /tmp/mobile-agent.log"
  exit 1
fi
