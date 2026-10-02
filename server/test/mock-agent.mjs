// Minimal ACP agent used by server.test.mjs to exercise the bridge without
// pulling in a real agent (Codex etc.). It speaks newline-delimited JSON-RPC
// on stdin/stdout and implements just enough of ACP:
//
//   initialize          -> capabilities + auth methods (incl. device code)
//   authenticate        -> (chat-gpt-device-code) issues elicitation/create
//   session/new         -> session id
//   session/prompt      -> streams two agent_message_chunks, then responds
//   $/ping              -> ignored
//
// Environment knobs:
//   MOCK_DELAY_MS   delay before responding to a prompt (default 0)
//   MOCK_LOGS       emit a stderr startup line

import { createInterface } from 'node:readline';

const delayMs = Number(process.env.MOCK_DELAY_MS || 0);
// When set, `session/new` fails with auth_required until `authenticate`
// succeeds — lets the GUI's sign-in flow (incl. device-code elicitation) be
// exercised end to end.
const requireAuth = process.env.MOCK_REQUIRE_AUTH === '1';
let authenticated = false;
let nextId = 1;
const pending = new Map();

process.stderr.write('mock-agent: starting\n');

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(msg);
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

/** Ask the client something and wait for its response. */
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

async function handle(msg) {
  if (msg.id !== undefined && msg.method === undefined) {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
    return;
  }
  if (msg.method === '$/ping') return;

  switch (msg.method) {
    case 'initialize':
      respond(msg.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [
          { id: 'api-key', name: 'API key', description: 'Use an API key' },
          { id: 'chat-gpt-device-code', name: 'ChatGPT (device code)', description: 'Sign in with a code' },
        ],
      });
      return;

    case 'authenticate': {
      if (msg.params?.methodId === 'chat-gpt-device-code') {
        // Emulate codex-acp's URL elicitation for the device-code flow.
        const res = await request('elicitation/create', {
          mode: 'url',
          elicitationId: 'elic-' + nextId,
          url: 'https://auth.example.com/device',
          message: 'Sign in to ChatGPT and enter this code: WXYZ-1234',
        });
        authenticated = true;
        respond(msg.id, { _meta: { elicitationAction: res.result?.action } });
      } else {
        authenticated = true;
        respond(msg.id, {});
      }
      return;
    }

    case 'session/new':
      if (requireAuth && !authenticated) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'Authentication required' },
        });
        return;
      }
      respond(msg.id, { sessionId: 'sess-mock-1', modes: null, models: null });
      return;

    case 'session/load':
      respond(msg.id, {});
      return;

    case 'session/prompt': {
      const sessionId = msg.params?.sessionId;
      const promptText = msg.params?.prompt?.[0]?.text ?? '';
      await new Promise((r) => setTimeout(r, delayMs));
      notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo:${promptText} ` } },
      });
      notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
      });
      respond(msg.id, { stopReason: 'end_turn' });
      return;
    }

    case 'session/cancel':
      return;

    default:
      if (msg.id !== undefined) {
        respond(msg.id, {});
      }
  }
}
