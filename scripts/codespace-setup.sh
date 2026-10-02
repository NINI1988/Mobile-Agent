#!/usr/bin/env bash
#
# One-time dev-container setup for Mobile Agent.
# Installs dependencies, builds the web app, and installs the Codex ACP agent.
# Called by postCreateCommand in .devcontainer/devcontainer.json.
#
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log() { printf '[mobile-agent] %s\n' "$*"; }

cd "$ROOT" || exit 1

log "Installing dependencies"
npm install --no-audit --no-fund || exit 1

log "Building the web app"
npm run build:web || exit 1

if command -v codex-acp >/dev/null 2>&1; then
  log "Codex ACP agent already installed"
else
  log "Installing the Codex ACP agent"
  npm install -g @agentclientprotocol/codex-acp@latest --no-audit --no-fund \
    || log "codex-acp install failed; the server will fall back to npx"
fi

log "Setup complete"
