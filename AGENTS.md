# Mobile Agent — repository notes

Mobile Agent is a mobile-first fork of [ACP UI](https://github.com/formulahendry/acp-ui)
(Vue 3 + Pinia + Vite + Tauri). It adds a small Node server so the app can run inside a
GitHub Codespace / dev container and drive a local coding agent from a phone browser.

## Architecture

```
Mobile browser  ──WebSocket (ACP JSON-RPC)──►  Mobile Agent server  ──stdio──►  ACP agent adapter  ──►  Codex / Copilot / Gemini
```

The browser speaks plain ACP over `/ws`; the server only translates ACP-over-WebSocket to
ACP-over-stdio and keeps the agent process alive across client disconnects. The whole ACP UI
client (sessions, `session/load` reconnect, permissions, tool calls, model/mode selection,
Markdown) is reused unchanged.

## Layout

- `server/` — plain Node ESM, no build step, no framework:
  - `index.mjs` — HTTP static server (`dist-web/`) + JSON API + WebSocket upgrade at `/ws`.
  - `agents.mjs` — agent registry (`MOBILE_AGENT_AGENTS` env → `.mobile-agent/agents.json` → built-in Codex).
  - `session.mjs` — `Session`/`SessionManager`: spawns the agent, routes frames, buffers
    `$/mobileAgent/*` server notes, survives disconnects.
  - `auth.mjs` — Codex device-code login: injects the URL-elicitation capability, answers
    `elicitation/create` server-side, pushes `$/mobileAgent/elicitation` to the GUI.
  - `test/` — `node:test` suite + `mock-agent.mjs` (a tiny ACP agent).
- `src/lib/server.ts` — client helpers for the server (base URL, `/ws` URL, config fetch).
- `src/components/ElicitationDialog.vue` — device-code card (copy code + open link).
- `scripts/install.sh` — `curl | bash` installer for *other* dev containers.
- `.devcontainer/devcontainer.json` — builds the web app and auto-starts the server.

## Server protocol extensions (not ACP)

| Method | Direction | Meaning |
|--------|-----------|---------|
| `$/mobileAgent/session` | server → client | server session id (for reconnect) |
| `$/mobileAgent/log` | server → client | agent stderr line (startup progress) |
| `$/mobileAgent/elicitation` | server → client | device-code URL + one-time code |
| `$/mobileAgent/elicitationComplete` | server → client | sign-in finished |
| `$/mobileAgent/error` | server → client | setup failure |

Client → server `$/ping` is a heartbeat answered/ignored at the transport layer.

## Commands

```sh
npm run test:server   # node:test bridge suite (mock agent) — always run before committing
npm run build:web     # vue-tsc --noEmit + vite build --mode web  → dist-web/
npm run build         # vue-tsc --noEmit + vite build (Tauri frontend)
npm run serve         # build:web then start the server
npm start             # serve existing dist-web/ + WebSocket bridge (PORT, default 12000)
npm run dev:web       # Vite HMR on :5173, proxies /api and /ws to :12000
npm run dev:server    # server only
```

There is no ESLint/Prettier config; `vue-tsc` is the type gate.

## Conventions / gotchas

- Source files in this repo use **CRLF** line endings. New files must match or the diff
  balloons (there is no `.gitattributes`).
- Branding is "Mobile Agent" for user-visible strings, but the upstream project name,
  repo URLs in attribution, and the Tauri `identifier` (`formulahendry.acp-ui`) are kept.
- Web builds only support remote agents over `ws://` / `wss://`; stdio agents are filtered
  out by `restrictedTransports()`.
- `server/` uses `ws` (already a dependency). Do not add a backend framework, DB, or auth
  stack — the design goal is a few hundred lines of Node.
