// End-to-end tests for the Mobile Agent server.
//
// Starts the real server (server/index.mjs) with the mock ACP agent as the
// configured agent, then drives it over WebSocket exactly like the browser
// does. Covers:
//   - initialize / session/new / prompt round-trip
//   - server-injected URL elicitation capability + device-code notification
//   - id rewriting (client ids are stable across the rewrite)
//   - buffering: a reconnecting client replays prior notifications
//   - session survival across a disconnect
//
// Run with: node --test server/test/server.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');
const PORT = 12199;
const BASE = `ws://127.0.0.1:${PORT}/ws`;

let serverProc;

function waitForListen(proc) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (buf) => {
      if (buf.toString().includes('listening')) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    proc.stderr.on('data', (buf) => process.stderr.write(`[server] ${buf}`));
  });
}

before(async () => {
  const agents = {
    mock: {
      name: 'Mock',
      command: process.execPath, // node
      args: [resolve(__dirname, 'mock-agent.mjs')],
      env: {},
    },
  };
  serverProc = spawn(process.execPath, [resolve(projectRoot, 'server', 'index.mjs')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      MOBILE_AGENT_OPEN: '0',
      MOBILE_AGENT_AGENTS: JSON.stringify(agents),
      MOBILE_AGENT_AGENT: 'mock',
      MOBILE_AGENT_IDLE_TIMEOUT_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForListen(serverProc);
});

after(() => {
  serverProc?.kill('SIGTERM');
});

/** Small client helper that mimics the browser transport. */
class TestClient {
  constructor(url) {
    this.ws = new WebSocket(url, ['acp.v1']);
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.serverNotifications = [];
    this.ready = new Promise((resolvePromise, reject) => {
      this.ws.on('open', resolvePromise);
      this.ws.on('error', reject);
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method && msg.id === undefined) {
        this.notifications.push(msg);
        if (msg.method.startsWith('$/mobileAgent/')) this.serverNotifications.push(msg);
        return;
      }
      if (msg.id !== undefined && msg.method === undefined) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(msg);
        }
      }
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, { resolve: resolvePromise });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  close() {
    return new Promise((resolvePromise) => {
      this.ws.on('close', resolvePromise);
      this.ws.close();
    });
  }

  /** Wait until `predicate` is true or the timeout elapses. */
  async waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return predicate();
  }
}

test('initialize / session/new / prompt round-trip', async () => {
  const client = new TestClient(BASE);
  await client.ready;

  const init = await client.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(init.result.protocolVersion, 1);
  assert.ok(Array.isArray(init.result.authMethods));

  const session = await client.request('session/new', { cwd: projectRoot, mcpServers: [] });
  assert.equal(session.result.sessionId, 'sess-mock-1');

  const prompt = await client.request('session/prompt', {
    sessionId: 'sess-mock-1',
    prompt: [{ type: 'text', text: 'hello' }],
  });
  assert.equal(prompt.result.stopReason, 'end_turn');

  const chunks = client.notifications
    .filter((n) => n.method === 'session/update')
    .map((n) => n.params.update.content?.text)
    .join('');
  assert.equal(chunks, 'echo:hello done');

  await client.close();
});

test('server advertises URL elicitation and surfaces the device code', async () => {
  const client = new TestClient(BASE);
  await client.ready;

  // The client deliberately does NOT send elicitation capability; the server
  // must inject it so codex-acp offers the device-code auth method.
  const init = await client.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  assert.ok(
    init.result.authMethods.some((m) => m.id === 'chat-gpt-device-code'),
    'device-code auth method should be advertised'
  );

  const auth = await client.request('authenticate', { methodId: 'chat-gpt-device-code' });
  assert.equal(auth.result._meta.elicitationAction, 'accept');

  const elicitation = client.serverNotifications.find(
    (n) => n.method === '$/mobileAgent/elicitation'
  );
  assert.ok(elicitation, 'server should push a device-code elicitation notification');
  assert.equal(elicitation.params.url, 'https://auth.example.com/device');
  assert.equal(elicitation.params.code, 'WXYZ-1234');

  await client.close();
});

test('session survives disconnect and replays server notes', async () => {
  const client1 = new TestClient(BASE);
  await client1.ready;
  const init = await client1.request('initialize', { protocolVersion: 1 });
  assert.ok(init.result);
  await client1.request('session/new', { cwd: projectRoot, mcpServers: [] });

  // Which session id did the server assign? Read it from the handshake note.
  const note = client1.serverNotifications.find(
    (n) => n.method === '$/mobileAgent/session'
  );
  assert.ok(note, 'server should announce the session id');
  const sessionId = note.params.sessionId;

  await client1.request('session/prompt', {
    sessionId: 'sess-mock-1',
    prompt: [{ type: 'text', text: 'before-drop' }],
  });
  await client1.close();

  // Reattach to the *same* session by id.
  const client2 = new TestClient(`${BASE}?session=${sessionId}`);
  await client2.ready;

  // The server note is replayed so the client can persist the id.
  await client2.waitFor(() =>
    client2.serverNotifications.some(
      (n) => n.method === '$/mobileAgent/session' && n.params.sessionId === sessionId
    )
  );
  assert.ok(
    client2.serverNotifications.some(
      (n) => n.method === '$/mobileAgent/session' && n.params.sessionId === sessionId
    ),
    'session note should be replayed on reconnect'
  );

  // The agent process survives a dropped browser transport and has already
  // completed ACP initialize. Reconnecting clients must receive the cached
  // handshake response before loading the existing session.
  const reinit = await client2.request('initialize', { protocolVersion: 1 });
  assert.equal(reinit.result.protocolVersion, 1);

  // The session must still work after reattaching.
  const prompt = await client2.request('session/prompt', {
    sessionId: 'sess-mock-1',
    prompt: [{ type: 'text', text: 'after-reconnect' }],
  });
  assert.equal(prompt.result.stopReason, 'end_turn');
  await client2.waitFor(() =>
    client2.notifications
      .filter((n) => n.method === 'session/update')
      .map((n) => n.params.update.content?.text)
      .join('')
      .includes('echo:after-reconnect')
  );
  const after = client2.notifications
    .filter((n) => n.method === 'session/update')
    .map((n) => n.params.update.content?.text)
    .join('');
  assert.ok(after.includes('echo:after-reconnect'));

  await client2.close();
});

test('session id note is delivered exactly once per attach', async () => {
  const client = new TestClient(BASE);
  await client.ready;
  await client.request('initialize', { protocolVersion: 1 });

  // Let any duplicate frames (direct send + buffered replay) arrive.
  await new Promise((r) => setTimeout(r, 100));
  const notes = client.serverNotifications.filter(
    (n) => n.method == '$/mobileAgent/session'
  );
  assert.equal(notes.length, 1, 'session note must not be duplicated on attach');
  await client.close();
});
