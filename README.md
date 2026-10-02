# Mobile Agent

<a href="https://apps.microsoft.com/detail/9P76NGS1VF2L?referrer=appbadge&mode=full" target="_blank"  rel="noopener noreferrer">
	<img src="https://get.microsoft.com/images/en-us%20dark.svg" width="200"/>
</a>

A modern, cross-platform client for the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) on desktop, mobile, and the web. Connect to AI coding agents like GitHub Copilot, Claude Code, Gemini CLI, Qwen Code, Codex CLI, OpenCode, OpenClaw, Kiro CLI, Hermes Agent, and any ACP-compatible agent from a unified interface.

![ACP UI Screenshot](assets/screenshot.png)

> **Mobile Agent** is a mobile-first fork of [ACP UI](https://github.com/formulahendry/acp-ui) by
> Jun Han ([@formulahendry](https://github.com/formulahendry)), used under the MIT License.
> It keeps the whole ACP UI client (chat, sessions, tool calls, permissions, reconnect) and adds
> a small built-in server so the app can run inside a GitHub Codespace and drive a coding agent
> from your phone. See [Mobile Agent server](#-mobile-agent-server) below.

## 📱 What is Mobile Agent?

Mobile Agent turns a GitHub Codespace (or any dev container) into a coding-agent backend you can
drive from a phone browser. One small Node process serves the web app, exposes a WebSocket ACP
endpoint, and launches a local coding agent over stdio — no separate bridge, database, or cloud
infrastructure.

```text
Mobile browser (phone)
        │  WebSocket (wss://)
        ▼
Mobile Agent server
        │  stdio (ACP, newline-delimited JSON-RPC)
        ▼
ACP agent adapter (e.g. codex-acp)
        │
        ▼
Coding agent (Codex, Copilot, Gemini, …)
```

The browser speaks plain ACP over the WebSocket; the server only translates ACP-over-WebSocket to
ACP-over-stdio and keeps the agent alive across phone disconnects. Existing ACP UI behaviour
(sessions, `session/load` reconnect, permissions, tool calls, model/mode selection, Markdown) is
reused unchanged.

## 🌍 Try it in your browser

No install required — open **[https://acp-ui.github.io/](https://acp-ui.github.io/)** and connect to a remote ACP agent over WebSocket. The web build supports the same chat, sessions, permissions, and traffic-monitor features as the desktop and mobile apps; it only omits local stdio agents and host filesystem access (which require a local subprocess and aren't available in a browser tab).

> Pages served over HTTPS can only open `wss://` URLs (browser mixed-content rule). For LAN `ws://` access, run the bundle locally (`npm run preview:web`) or use a `wss://` tunnel — see [Connecting from your phone or browser](#-connecting-from-your-phone-or-browser), the same setup works for the web build.

## 📥 Installation

Download the latest release for your platform from [GitHub Releases](https://github.com/formulahendry/acp-ui/releases):

| Platform | Download |
|----------|----------|
| **Web** | [https://acp-ui.github.io/](https://acp-ui.github.io/) — no install, opens in any modern browser |
| **Windows** | [.msi installer](https://github.com/formulahendry/acp-ui/releases/latest) or [.exe (NSIS)](https://github.com/formulahendry/acp-ui/releases/latest) |
| **macOS (Apple Silicon)** | [.dmg (ARM64)](https://github.com/formulahendry/acp-ui/releases/latest) |
| **macOS (Intel)** | [.dmg (x64)](https://github.com/formulahendry/acp-ui/releases/latest) |
| **Linux (x64)** | [.deb](https://github.com/formulahendry/acp-ui/releases/latest) or [.AppImage](https://github.com/formulahendry/acp-ui/releases/latest) or [.rpm](https://github.com/formulahendry/acp-ui/releases/latest) |
| **Linux (ARM64)** | [.deb](https://github.com/formulahendry/acp-ui/releases/latest) or [.AppImage](https://github.com/formulahendry/acp-ui/releases/latest) or [.rpm](https://github.com/formulahendry/acp-ui/releases/latest) |
| **Android** | [.apk](https://github.com/formulahendry/acp-ui/releases/latest) — sideload via "Install unknown apps" |
| **iOS** | Build from source (see [Building for iOS](#building-for-ios)) — no prebuilt binary |

> Mobile and web builds connect to remote agents over WebSocket. See [Connecting from your phone or browser](#-connecting-from-your-phone-or-browser) for how to expose a local agent so a phone or browser can reach it.

### macOS first-launch note

The macOS `.dmg` builds are ad-hoc signed but **not** notarized (no paid Apple Developer account), so on first launch macOS shows a dialog like *"Apple could not verify acp-ui is free of malware."* The app is not damaged — this is Gatekeeper's standard warning for un-notarized apps. Easiest fix, run once after installing or upgrading:

```bash
xattr -dr com.apple.quarantine /Applications/acp-ui.app
```

Then open the app normally. Alternatives if you'd rather not use the terminal:

- **macOS 15 Sequoia and later** — open **System Settings → Privacy & Security**, scroll to the bottom, click **Open Anyway** next to the acp-ui entry, authenticate, then re-launch the app.
- **macOS 14 Sonoma and earlier** — right-click (or Control-click) `acp-ui.app` in Finder → **Open** → click **Open** in the follow-up dialog.

## ✨ Features

- **Mobile-first chat UI** — The chat is the whole interface on a phone; tool calls and agent
  activity stay available but out of the way
- **Built-in server for Codespaces** — One `npm start` serves the app, the WebSocket ACP bridge, and
  the agent process (no separate `stdio-to-ws`)
- **Survives disconnects** — The agent keeps running when your phone drops the socket, and the
  session is reattached on reconnect
- **Device-code sign-in in the GUI** — Codex (and any agent using URL elicitation) shows the
  verification link and one-time code in the app, with copy-to-clipboard
- **Multi-Agent Support** — Connect to any ACP-compatible agent
- **Remote agents over WebSocket** — Talk to agents on another machine via `ws://` / `wss://`
- **Web app** — Run in any modern browser at [acp-ui.github.io](https://acp-ui.github.io/) without installing anything
- **Mobile** — Android APK shipped on Releases; iOS via local Xcode build
- **Foreground reconnect** — On mobile and the web, automatically reattaches to your session when the app/tab regains focus
- **Idle keep-alive** — Sends a JSON-RPC `$/ping` heartbeat every 25 seconds so NAT/proxy idle timeouts don't drop your WebSocket
- **Session Management** — Create, resume, and manage conversation sessions
- **Rich Chat Interface** — Markdown rendering, syntax highlighting, tool call visualization
- **Slash Commands** — Quick access to agent capabilities with `/command` syntax
- **Permission Controls** — Approve or deny agent actions before execution
- **Session Modes** — Switch between agent modes (ask, code, architect, etc.)
- **Model Picker** — Select from available AI models (unstable API)
- **Agent Thinking** — View the agent's reasoning process (collapsible)
- **Environment Variables** — Configure per-agent environment variables (API keys, settings)
- **Traffic Monitor** — Debug and inspect ACP protocol messages in real-time
- **Hot-Reload Config** — Edit agent configurations without restarting (desktop)
- **Cross-Platform** — Web (any modern browser), Windows, macOS (ARM/Intel), Linux (x64/ARM64), Android, iOS

## 🎯 Default Agents

ACP UI comes pre-configured with these agents:

| Agent | Package |
|-------|---------|
| [GitHub Copilot](https://github.com/github/copilot-language-server-release?tab=readme-ov-file#agent-client-protocol-acp-preview) | `@github/copilot-language-server` |
| [Claude Code](https://github.com/anthropics/claude-code) | `@agentclientprotocol/claude-agent-acp` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `@google/gemini-cli` |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | `@qwen-code/qwen-code` |
| [Auggie CLI](https://github.com/AugmentCode/auggie) | `@augmentcode/auggie` |
| [Qoder CLI](https://github.com/qoder-ai/qodercli) | `@qoder-ai/qodercli` |
| [Codex CLI](https://github.com/zed-industries/codex-acp) | `@zed-industries/codex-acp` |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode-ai` |
| [OpenClaw](https://github.com/nicobailon/openclaw) | `openclaw` |
| [Kiro CLI](https://github.com/aws/kiro) | `kiro-cli` |
| [Hermes Agent](https://github.com/nichochar/hermes) | `hermes` |

## 🛠️ Configuration

Agent configurations are stored in:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\acp-ui\agents.json` |
| macOS | `~/Library/Application Support/acp-ui/agents.json` |
| Linux | `~/.config/acp-ui/agents.json` |
| Android | `/data/data/formulahendry.acp_ui/files/agents.json` (managed via Settings UI) |
| iOS | App sandbox — managed via Settings UI |
| Web | Browser `localStorage` (key `acp-ui:agents`) — managed via Settings UI |

> On mobile and the web the config file isn't user-accessible — add and edit agents through the in-app **Settings** dialog. Stdio agents are filtered out of the list since they can't run in a browser or on a phone. Web-app config is per-browser per-origin: it doesn't sync across machines, and clearing site data wipes it.

### Local stdio agents (desktop)

### Example Configuration

```json
{
  "agents": {
    "GitHub Copilot": {
      "command": "npx",
      "args": ["@github/copilot-language-server@latest", "--acp"],
      "env": {}
    },
    "Claude Code": {
      "command": "npx",
      "args": ["@agentclientprotocol/claude-agent-acp@latest"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    },
    "Gemini CLI": {
      "command": "npx",
      "args": ["@google/gemini-cli@latest", "--experimental-acp"],
      "env": {}
    },
    "Qwen Code": {
      "command": "npx",
      "args": ["@qwen-code/qwen-code@latest", "--acp", "--experimental-skills"],
      "env": {}
    },
    "Auggie CLI": {
      "command": "npx",
      "args": ["@augmentcode/auggie@latest", "--acp"],
      "env": {"AUGMENT_DISABLE_AUTO_UPDATE": "1"}
    },
    "Qoder CLI": {
      "command": "npx",
      "args": ["@qoder-ai/qodercli@latest", "--acp"],
      "env": {}
    },
    "Codex CLI": {
      "command": "npx",
      "args": ["@zed-industries/codex-acp@latest"],
      "env": {}
    },
    "OpenCode": {
      "command": "npx",
      "args": ["opencode-ai@latest", "acp"],
      "env": {}
    },
    "OpenClaw": {
      "command": "npx",
      "args": ["openclaw", "acp"],
      "env": {}
    },
    "Kiro CLI": {
      "command": "kiro-cli",
      "args": ["acp"],
      "env": {}
    },
    "Hermes Agent": {
      "command": "hermes",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

> **Note**: Environment variables are passed to the agent process on startup. Use these for API keys, custom settings, or overriding default behavior.

### Remote agents over WebSocket

For agents running on another machine — or for connecting from a phone to an agent on your laptop — use the `websocket` transport instead of `command`:

```json
{
  "agents": {
    "Copilot CLI (remote)": {
      "transport": "websocket",
      "url": "wss://acp.example.com/v1",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Both `ws://` (cleartext, for LAN / Dev Tunnels) and `wss://` (TLS) are accepted. `Authorization: Bearer <token>` is propagated as a WebSocket subprotocol because browser/WebView WebSocket APIs cannot set custom HTTP headers.

> **Note**: Filesystem RPCs (`fs/read_text_file`, `fs/write_text_file`) are only available on Tauri desktop (Windows, macOS, Linux). On mobile and web clients the capabilities are advertised as `false` and any incoming `fs/*` request from the agent is rejected with JSON-RPC `-32601 Method not found`. For remote agents the working directory path is interpreted on the **agent's host**, not on the client device.

## 📡 Mobile Agent server

The server lives in [`server/`](server) and is a few hundred lines of plain Node ESM — no build
step, no framework, no database. It does three things:

1. serves the built web app (`dist-web/`) as static files,
2. exposes a WebSocket ACP endpoint at `/ws`, and
3. spawns the configured ACP agent over stdio and keeps it alive across client disconnects.

It replaces the external [`@rebornix/stdio-to-ws`](https://www.npmjs.com/package/@rebornix/stdio-to-ws)
bridge: the same translation now happens in-process, so there is one component to run instead of two.
(`stdio-to-ws` still works and is still documented below if you prefer a standalone bridge.)

### Quick start in a Codespace / dev container

This repo ships a [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) that builds
the web app and starts the server automatically. Open the repo in a Codespace, then open the
forwarded port **12000** on your phone:

```text
https://<codespace-name>-12000.<region>.github.dev/
```

Locally it is just:

```sh
npm install
npm start          # serve an existing dist-web/ build + WebSocket bridge
# or
npm run serve      # build the web app, then start
# or, for a live-reloading frontend + bridge during development
npm run dev:server
```

The server prints the URL to open (including the Codespace URL) on startup.

The dev container keeps `.devcontainer/devcontainer.json` small by delegating to two scripts:

| Script | Runs on | Does |
|--------|---------|------|
| `scripts/codespace-setup.sh` | `postCreateCommand` | `npm install`, build the web app, install Codex |
| `scripts/codespace-start.sh` | `postStartCommand`, `postAttachCommand` | start the server if it isn't running |

**Where is the server output?** `postStartCommand` runs invisibly in the background, so its
output is not in a terminal — it goes to the noisy Codespaces log. To see it, Mobile Agent ships a
VS Code task in `.vscode/tasks.json` that runs **on folder open** in its own terminal panel
(*“Mobile Agent: start”*). If VS Code asks whether to allow automatic tasks, choose **Allow and
Run**. You can also run it via **Terminal → Run Task…**. The background server writes to
**`/tmp/mobile-agent.log`**; to restart by hand:

```sh
pkill -f '[s]erver/index.mjs'
bash scripts/codespace-start.sh            # background
bash scripts/codespace-start.sh --foreground  # attached to the terminal
```

### Using Mobile Agent in another project

You can drive *any* dev container with Mobile Agent without copying this repo in. From the root of
the project you want to work on:

```sh
curl -fsSL https://raw.githubusercontent.com/NINI1988/Mobile-Agent/main/scripts/install.sh | bash
```

The script clones Mobile Agent into `~/.mobile-agent/app`, builds the web bundle, installs the
Codex ACP agent globally, and starts the server with the working directory set to the project you
ran it from. The server keeps running in the background after the script exits. Open the printed
URL on your phone and sign in from the GUI. Environment overrides: `MOBILE_AGENT_CWD`,
`MOBILE_AGENT_AGENT`, `PORT`, `MOBILE_AGENT_REPO`, `MOBILE_AGENT_REF`, `MOBILE_AGENT_DIR`.

### Configuring agents

An “agent” is just a local command that speaks ACP over stdio. The server resolves the registry in
this order (highest priority first):

1. `MOBILE_AGENT_AGENTS` — a JSON object in the environment,
2. `.mobile-agent/agents.json` in the workspace,
3. a built-in default: **Codex** — a globally installed `codex-acp` if present, otherwise
   `npx -y @agentclientprotocol/codex-acp@latest`.

```json
{
  "agents": {
    "codex":   { "name": "Codex",   "command": "npx", "args": ["-y", "@agentclientprotocol/codex-acp@latest"], "env": { "NO_BROWSER": "1" } },
    "copilot": { "name": "GitHub Copilot", "command": "copilot", "args": ["--acp"] },
    "gemini":  { "name": "Gemini",  "command": "gemini", "args": ["--experimental-acp"] }
  }
}
```

`MOBILE_AGENT_AGENT` picks the default agent (the one the GUI preselects). Each entry supports
`name`, `command`, `args`, `env`, and `cwd`; adding an agent is a single JSON object, not a plugin.
The GUI lists every configured agent in the Agent dropdown, so switching between Codex, Copilot,
Gemini, etc. is just a selection.

### Signing in (device code)

Some agents need an interactive login. Codex is the worked example: when it is not signed in, the
GUI shows an **Authentication Required** dialog; choose **ChatGPT (device code)** and the server
surfaces the verification URL and one-time code as a card in the chat, with a **Copy** button and a
link that opens the sign-in page. Enter the code there and the agent continues automatically —
there is no terminal step. (The server declares the URL-elicitation capability and answers the
agent’s `elicitation/create` request itself, then pushes the code to the GUI.)

Mobile Agent only uses **free sign-in paths**: Codex signs in with a ChatGPT account via the
device-code flow (no API key, no paid API usage). The server sets `NO_BROWSER=1` so the
browser-callback method — which cannot complete headlessly in a Codespace — is hidden, leaving the
device-code method as the single, free option.

### Security

The server has **no authentication** — it is meant to run behind a tunnel you control.
A GitHub Codespace port is private to your account by default, so the forwarded URL is only
reachable by you. Do not expose the port publicly (set it to Public in the Ports tab) or bind
it to an untrusted network: anyone who can reach `/ws` can run commands through the agent in
your workspace. Keep `HOST` at its default (`0.0.0.0`) only inside the container and put a
tunnel (Codespaces, Dev Tunnels, SSH) in front of it otherwise.

### Sessions and reconnect

The server owns the agent process and its session. When the phone drops the WebSocket — backgrounded
app, changed network, locked screen — the agent keeps running. When the browser reconnects it sends
the server session id it saved, and the server reattaches it to the *same* process; the conversation
is restored through the existing ACP `session/load` path. No second session implementation is
involved: the client-side reconnect logic is unchanged, it simply has a server-side session id to
return to.

### HTTP endpoints

| Path | Purpose |
|------|---------|
| `/ws?session=<id>&agent=<id>&cwd=<path>` | ACP-over-WebSocket bridge |
| `/api/health` | liveness + configured agents |
| `/api/agents` | agent list + default + workspace cwd |
| `/api/sessions` | known sessions (`GET`), `DELETE /api/sessions/<id>` to stop one |

## 🌐 Connecting from your phone or browser

The mobile and web builds can only talk to remote agents (no subprocess in a phone or browser sandbox), so you need to expose a local stdio agent over a network endpoint. The recommended bridge is [`@rebornix/stdio-to-ws`](https://www.npmjs.com/package/@rebornix/stdio-to-ws), which speaks ACP-over-WebSocket on one end and stdio on the other. The same setup works for the web build at [acp-ui.github.io](https://acp-ui.github.io/) — with one extra rule: the HTTPS page can only open `wss://` URLs (see [HTTPS pages must use `wss://`](#browser-only-https-pages-must-use-wss) below).

### Same Wi-Fi (LAN)

On your computer:

```sh
npx @rebornix/stdio-to-ws "copilot --acp" --port 3000 --persist --grace-period -1
```

- Allow inbound TCP 3000 in your OS firewall.
  - Windows (one-time, elevated PowerShell):
    ```powershell
    New-NetFirewallRule -DisplayName "stdio-to-ws" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
    ```
- Find your computer's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip a` on macOS / Linux).
- In ACP UI on the phone, add a websocket agent with URL `ws://<LAN IP>:3000/`.

> **Android emulator** uses `ws://10.0.2.2:3000/`. **USB-tethered phone** can use `ws://localhost:3000/` after running `adb reverse tcp:3000 tcp:3000`.

### From anywhere (Microsoft Dev Tunnels)

`stdio-to-ws` exposes the agent on `localhost`; pair it with [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) to get a `wss://` URL reachable from the public internet.

```sh
# Terminal 1 — wrap the agent as a WebSocket on port 3000.
npx @rebornix/stdio-to-ws "copilot --acp" --port 3000 --persist --grace-period -1

# Terminal 2 — expose port 3000 publicly. First-run prompts for login.
devtunnel host -p 3000
```

`devtunnel host` prints a URL like:

```
https://<id>-3000.<region>.devtunnels.ms
```

Use the **`wss://...devtunnels.ms/`** form (replace `https` with `wss`) as the agent URL in ACP UI on the phone or in the [web app](https://acp-ui.github.io/).

#### Stable URL across restarts

The ad-hoc URL changes every run. To get a reusable one:

```sh
# One-time setup
devtunnel user login
devtunnel create my-acp -a
devtunnel port create my-acp -p 3000 --protocol https

# Every session afterwards
devtunnel host my-acp
```

Reference: [Dev Tunnels CLI commands](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands).

#### Browser-only: HTTPS pages must use `wss://`

When you open ACP UI in a browser at [acp-ui.github.io](https://acp-ui.github.io/), the page is served over HTTPS, and the browser blocks plain `ws://` connections (mixed-content rule). Two options:

- **Easy:** front your bridge with a `wss://` URL (Dev Tunnels above gives you one for free).
- **LAN-only:** serve the bundle locally instead of the hosted site:

  ```sh
  git clone https://github.com/formulahendry/acp-ui.git
  cd acp-ui && npm install && npm run preview:web
  ```

  then open `http://localhost:4173/` and add a `ws://<LAN IP>:3000/` agent as usual.

#### Why `--persist --grace-period -1`?

Mobile OSes freeze backgrounded apps within seconds, dropping the WebSocket. `--persist` tells the bridge to keep the wrapped agent alive across disconnects, and `--grace-period -1` makes that timeout infinite. When ACP UI on the phone returns to the foreground, it transparently reattaches via `session/load` and your conversation resumes. Without persistence, you'd lose the running agent every time you switched apps.

> **Tip**: a future `stdio-to-ws` release will integrate Dev Tunnels into the bridge itself (`--tunnel-name <name>`, currently only on its `dev` branch). Once published you'll be able to collapse the two terminals into one.

## 📖 Usage

1. **Select an Agent** — Choose from the dropdown in the sidebar (☰ on mobile / narrow web).
2. **Set Working Directory** — Pick a folder on desktop, or type an absolute path on mobile / web. The path is interpreted on the **agent's host**, not your device.
3. **Create Session** — Tap **New Session** to start chatting.
4. **Use Slash Commands** — Type `/` to see available commands.
5. **Resume Sessions** — Tap a saved session in the sidebar to resume.

## 🚀 Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+
- Platform-specific build tools (see [Tauri Prerequisites](https://tauri.app/start/prerequisites/))

### Setup

```bash
# Clone the repository
git clone https://github.com/formulahendry/acp-ui.git
cd acp-ui

# Install dependencies
npm install

# Run in development mode (Tauri desktop)
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

### Building / running the web app

The web app uses the same Vue 3 frontend, with the Tauri runtime swapped out for browser-native APIs (WebSocket, `localStorage`). It only supports remote agents over `ws://` / `wss://`.

```sh
# Dev server with HMR (default port 5173)
npm run dev:web

# Production build → dist-web/
npm run build:web

# Serve dist-web/ locally to verify the production bundle
npm run preview:web
```

The live deployment at [acp-ui.github.io](https://acp-ui.github.io/) is published from `dist-web/` by [.github/workflows/deploy-web.yml](.github/workflows/deploy-web.yml) on every push to `main`.

### Running the Mobile Agent server

The server is plain Node ESM under [`server/`](server) — there is nothing to compile. It serves
`dist-web/` and bridges ACP over WebSocket to a stdio agent.

```sh
npm run build:web     # produce dist-web/
npm start             # serve dist-web/ + WebSocket bridge on PORT (default 12000)

npm run serve         # build:web then start, in one step
npm run dev:web       # Vite dev server (HMR); it proxies /ws and /api to npm run dev:server
npm run dev:server    # server only

npm run test:server   # node:test suite for the bridge (uses a mock ACP agent)
```

Useful environment variables: `PORT`, `HOST`, `MOBILE_AGENT_CWD` (workspace the agent edits),
`MOBILE_AGENT_AGENT` (default agent id), `MOBILE_AGENT_AGENTS` (inline agent registry JSON),
`MOBILE_AGENT_IDLE_TIMEOUT_MS` (stop an idle agent after N ms; `0` disables),
`MOBILE_AGENT_OPEN=0` (don’t try to open a browser on startup).

### Building for Android

Prerequisites:

- JDK 17 (Temurin recommended)
- Android SDK platform 34, build-tools 34, NDK 26
- Rust Android targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
- Set `ANDROID_HOME` and `NDK_HOME` env vars

```sh
# `src-tauri/gen/android/` is gitignored; this regenerates it.
npm run tauri android init

# Allow plain ws:// to LAN agents (the init template defaults this off via
# a Gradle placeholder). Required for ACP UI's LAN-agent UX.
sed -i 's|usesCleartextTraffic="\${usesCleartextTraffic}"|usesCleartextTraffic="true"|' \
  src-tauri/gen/android/app/src/main/AndroidManifest.xml

# Debug-signed APK suitable for sideload.
npm run tauri android build -- --debug --apk
# Output: src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

To run on a device with hot-reload during development:

```sh
npm run tauri android dev
```

If the device can't reach the dev server, allow port `1420` through your firewall, or USB-tether the phone and run `adb reverse tcp:1420 tcp:1420` first.

### Building for iOS

Prerequisites:

- macOS with Xcode 15+
- An Apple Developer team for signing
- Rust iOS targets: `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`

```sh
npm run tauri ios init
```

Then edit `src-tauri/gen/apple/<app>_iOS/Info.plist` and add:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key><true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>ACP UI connects to ACP agents you configure, including agents on your local network.</string>
```

Build and install via Xcode (`.xcworkspace`), or run on a connected device:

```sh
npm run tauri ios dev
```

iOS doesn't ship a binary today because it requires per-developer signing and an Apple Developer Program membership.

## 🔗 Links

- [Agent Client Protocol](https://agentclientprotocol.com/)
- [Tauri Documentation](https://tauri.app/)
- [ACP UI (upstream)](https://github.com/formulahendry/acp-ui) — the project Mobile Agent is forked from

## 📄 License

MIT License. Mobile Agent is a fork of [ACP UI](https://github.com/formulahendry/acp-ui) by Jun Han
([@formulahendry](https://github.com/formulahendry)); the original copyright and license are retained.
