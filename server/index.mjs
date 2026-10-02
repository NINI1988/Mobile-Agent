// Mobile Agent server entry point.
//
// A deliberately small Node server that does three things:
//   1. serves the built web app (dist-web/) as static files,
//   2. exposes a WebSocket endpoint (/ws) that bridges a browser to a local
//      ACP agent over stdio, and
//   3. keeps agent sessions alive across client disconnects.
//
// It is designed to run inside a GitHub Codespace (or any dev container)
// with `node server/index.mjs` — no database, auth stack, or cloud infra.
//
//   Browser ──WebSocket──► Mobile Agent server ──stdio──► codex-acp ──► Codex

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { loadAgents } from './agents.mjs';
import { SessionManager } from './session.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const distDir = resolve(projectRoot, 'dist-web');

const PORT = Number(process.env.PORT || 12000);
const HOST = process.env.HOST || '0.0.0.0';
const NAME = 'Mobile Agent';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const { agents, defaultAgent, cwd } = loadAgents({ cwd: projectRoot });
const sessions = new SessionManager({
  agents,
  defaultAgentId: defaultAgent,
  cwd,
  idleTimeoutMs: Number(process.env.MOBILE_AGENT_IDLE_TIMEOUT_MS || 0),
});

if (Object.keys(agents).length === 0) {
  console.warn('[mobile-agent] No agents configured.');
} else {
  console.log(
    `[mobile-agent] Agents: ${Object.values(agents).map((a) => a.name).join(', ')} (default: ${defaultAgent})`
  );
}

// ---------------------------------------------------------------------------
// HTTP: static web app + small JSON API
// ---------------------------------------------------------------------------

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function serveStatic(req, res) {
  // Strip query string and prevent path traversal.
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, rel);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // SPA fallback: unknown paths without a file extension serve index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    if (extname(rel)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    filePath = join(distDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(notBuiltPage());
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  const data = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(data);
}

function notBuiltPage() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mobile Agent</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>Mobile Agent</h1>
<p>The web app has not been built yet. Build it once, then reload this page:</p>
<pre style="background:#f4f4f4;padding:1rem;border-radius:8px">npm run build:web</pre>
<p>Or run the dev server with <code>npm run dev:server</code>.</p>
</body></html>`;
}

const server = createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      name: NAME,
      defaultAgent,
      agents: Object.values(agents).map((a) => ({ id: a.id, name: a.name })),
    });
  }

  if (urlPath === '/api/agents') {
    return sendJson(res, 200, {
      agents: Object.values(agents).map((a) => ({
        id: a.id,
        name: a.name,
        cwd: a.cwd,
      })),
      defaultAgent,
      cwd,
    });
  }

  if (urlPath === '/api/sessions') {
    return sendJson(res, 200, { sessions: sessions.list() });
  }

  if (urlPath.startsWith('/api/sessions/')) {
    const id = urlPath.slice('/api/sessions/'.length);
    if (req.method === 'DELETE') {
      const ok = sessions.delete(id);
      return sendJson(res, ok ? 200 : 404, { ok });
    }
  }

  return serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// WebSocket: ACP bridge endpoint
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const agentId = url.searchParams.get('agent') || undefined;
    const sessionId = url.searchParams.get('session') || undefined;
    const reqCwd = url.searchParams.get('cwd') || undefined;

    let session;
    try {
      session = sessions.getOrCreate(sessionId, agentId, reqCwd);
    } catch (e) {
      console.warn(`[mobile-agent] WS attach failed: ${e.message}`);
      try {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: '$/mobileAgent/error',
            params: { message: e.message },
          })
        );
      } catch {
        /* ignore */
      }
      ws.close(1011, 'session setup failed');
      return;
    }

    console.log(
      `[mobile-agent] client attached to session ${session.id} (agent=${session.agentId}, clients=${session.clients.size + 1})`
    );
    // `session.attach` announces the server-side session id (buffered so
    // reconnecting clients receive it too) and starts replaying.
    session.attach(ws);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function codespaceUrl(port) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (name && domain) return `https://${name}-${port}.${domain}`;
  return null;
}

server.listen(PORT, HOST, () => {
  const publicUrl = codespaceUrl(PORT);
  console.log(`\n  ${NAME} listening on http://${HOST}:${PORT}`);
  if (publicUrl) console.log(`  Open in your phone browser: ${publicUrl}`);
  console.log('');
  if (process.env.MOBILE_AGENT_OPEN !== '0') {
    const target = publicUrl || `http://localhost:${PORT}`;
    maybeOpenBrowser(target);
  }
});

/** Best-effort: open the Codespace URL in the container's default browser. */
function maybeOpenBrowser(url) {
  if (process.env.CI || process.env.MOBILE_AGENT_OPEN === '0') return;
  import('node:child_process')
    .then(({ spawn }) => {
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {
        /* no browser in the container — the printed URL is enough */
      });
      child.unref();
    })
    .catch(() => {
      /* ignore */
    });
}

function shutdown() {
  console.log('\n[mobile-agent] shutting down…');
  sessions.shutdown();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
