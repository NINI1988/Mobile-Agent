// Session manager: the heart of the Mobile Agent server.
//
// One "session" owns exactly one local ACP agent process (spawned over
// stdio) and zero or more connected browser clients (WebSockets). The
// session outlives any individual client connection, so a phone that loses
// connectivity and reconnects can resume the same running agent.
//
// The server is a *transparent ACP proxy with id rewriting*. It does not
// implement the ACP protocol itself — the browser-side `AcpClientBridge`
// already drives the full handshake (initialize / session/new / session/load
// / session/prompt ...). The server only:
//
//   1. spawns the agent process,
//   2. rewrites JSON-RPC ids so the agent and the client each see a
//      consistent, collision-free id space across reconnects,
//   3. buffers agent->client frames so a reconnecting client can rebuild
//      its view, and
//   4. lets the server itself issue a couple of client requests (URL
//      elicitation for Codex device-code login).
//
// This keeps the ACP semantics in the existing client implementation and
// avoids a second, divergent protocol implementation.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  injectElicitationCapability,
  handleAgentRequest,
  handleAgentNotification,
} from './auth.mjs';

const MAX_BUFFER_FRAMES = 5000;
const MAX_LOG_LINES = 500;

/** A JSON-RPC notification the server understands directly. */
const SERVER_PING_METHOD = '$/ping';

export class SessionManager {
  /**
   * @param {object} opts
   * @param {Record<string, object>} opts.agents   agent registry
   * @param {string} opts.defaultAgentId
   * @param {string} opts.cwd                      default working directory
   * @param {number} [opts.idleTimeoutMs]          0 disables idle shutdown
   * @param {string} [opts.persistPath]
   */
  constructor({ agents, defaultAgentId, cwd, idleTimeoutMs = 0, persistPath }) {
    this.agents = agents;
    this.defaultAgentId = defaultAgentId;
    this.cwd = cwd;
    this.idleTimeoutMs = idleTimeoutMs;
    this.persistPath =
      persistPath || resolve(cwd, '.mobile-agent', 'sessions.json');

    /** @type {Map<string, Session>} */
    this.sessions = new Map();
    this.loadPersisted();
  }

  loadPersisted() {
    try {
      if (!existsSync(this.persistPath)) return;
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      if (!Array.isArray(data.sessions)) return;
      for (const s of data.sessions) {
        if (!s || typeof s.id !== 'string') continue;
        // Only restore metadata; the agent process itself is (re)started on
        // demand the next time a client attaches.
        this.sessions.set(s.id, new Session({
          id: s.id,
          agentId: s.agentId,
          cwd: s.cwd,
          title: s.title,
          createdAt: s.createdAt,
          manager: this,
          restoreOnly: true,
        }));
      }
      console.log(`[sessions] Restored ${this.sessions.size} persisted session(s)`);
    } catch (e) {
      console.warn(`[sessions] Failed to load persisted sessions: ${e.message}`);
    }
  }

  persist() {
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const sessions = [...this.sessions.values()].map((s) => ({
        id: s.id,
        agentId: s.agentId,
        cwd: s.cwd,
        title: s.title,
        createdAt: s.createdAt,
      }));
      writeFileSync(this.persistPath, JSON.stringify({ sessions }, null, 2));
    } catch (e) {
      console.warn(`[sessions] Failed to persist sessions: ${e.message}`);
    }
  }

  list() {
    return [...this.sessions.values()].map((s) => s.describe());
  }

  /**
   * Find an existing session or create (and start) a new one.
   *
   * @param {string|undefined} sessionId  reuse this id if provided
   * @param {string|undefined} agentId
   * @param {string|undefined} cwd
   */
  getOrCreate(sessionId, agentId, cwd) {
    if (sessionId && this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }
    const id = sessionId || randomUUID();
    const agent = agentId || this.defaultAgentId;
    if (!agent || !this.agents[agent]) {
      throw new Error(
        `Unknown agent '${agentId ?? '(none)'}'. Configured agents: ${Object.keys(this.agents).join(', ') || '(none)'}`
      );
    }
    const session = new Session({
      id,
      agentId: agent,
      cwd: cwd || this.agents[agent].cwd || this.cwd,
      manager: this,
    });
    this.sessions.set(id, session);
    this.persist();
    return session;
  }

  delete(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.dispose('session deleted');
    this.sessions.delete(sessionId);
    this.persist();
    return true;
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      session.dispose('server shutting down');
    }
    this.sessions.clear();
  }
}

/**
 * A single ACP session bound to one agent process.
 */
class Session {
  constructor({ id, agentId, cwd, title, createdAt, manager, restoreOnly = false }) {
    this.id = id;
    this.agentId = agentId;
    this.cwd = cwd;
    this.title = title || '';
    this.createdAt = createdAt || Date.now();
    this.manager = manager;
    this.idleTimeoutMs = manager.idleTimeoutMs ?? 0;

    this.proc = null;
    this.alive = false;
    this.sessionNoteSent = false;
    /** @type {Set<import('ws').WebSocket>} */
    this.clients = new Set();
    /**
     * Buffer of *server* notifications (`$/mobileAgent/*`) only — session id
     * assignment and device-code elicitations. These are replayed to a
     * reconnecting client so it can reattach and re-show a pending login.
     *
     * Agent ACP frames are deliberately NOT buffered: conversation history is
     * restored by the agent via `session/load` (which ACP-UI already drives),
     * so replaying raw agent frames here would duplicate messages.
     */
    this.buffer = [];
    /** Recent agent stderr lines, surfaced as a startup log. */
    this.logs = [];

    // Id allocators (session-global, monotonic — never reused).
    this.nextAgentId = 1;
    this.nextClientId = 1;
    this.nextServerId = -1;

    /** agentId -> { clientId, ws } for client-originated requests. */
    this.pendingToAgent = new Map();
    /** clientId -> agentId for agent-originated requests. */
    this.pendingToClient = new Map();
    /** serverId -> resolver for server-originated requests. */
    this.pendingServer = new Map();

    this.idleTimer = null;
    this.rl = null;
    this.rlErr = null;

    if (!restoreOnly) this.start();
  }

  describe() {
    return {
      id: this.id,
      agentId: this.agentId,
      cwd: this.cwd,
      title: this.title,
      createdAt: this.createdAt,
      alive: this.alive,
      clients: this.clients.size,
    };
  }

  /** Spawn (or respawn) the agent process. */
  start() {
    const agent = this.manager.agents[this.agentId];
    if (!agent) {
      console.warn(`[session ${this.id}] agent '${this.agentId}' not configured`);
      return;
    }

    console.log(
      `[session ${this.id}] spawning '${agent.name}' (${agent.command} ${agent.args.join(' ')}) in ${this.cwd}`
    );

    try {
      this.proc = spawn(agent.command, agent.args, {
        cwd: this.cwd,
        env: { ...process.env, ...agent.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // `npx` on Windows is a .cmd shim; other platforms spawn directly.
        shell: process.platform === 'win32',
      });
    } catch (e) {
      this.appendLog(`failed to spawn agent: ${e.message}`);
      return;
    }

    this.alive = true;

    this.proc.on('error', (e) => {
      this.appendLog(`agent process error: ${e.message}`);
      this.broadcastLog(`agent process error: ${e.message}`);
    });

    this.proc.on('exit', (code, signal) => {
      const reason = `agent exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`;
      console.log(`[session ${this.id}] ${reason}`);
      this.alive = false;
      this.proc = null;
      this.appendLog(reason);
      this.broadcastLog(reason);
      // Close client sockets so their transport reports a close and the UI
      // can offer a reconnect. The session itself stays so a reconnect
      // respawns the agent.
      for (const ws of this.clients) {
        try {
          ws.close(1011, 'agent process exited');
        } catch {
          /* ignore */
        }
      }
      this.clients.clear();
      this.clearPending();
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this.onAgentLine(line));

    this.rlErr = createInterface({ input: this.proc.stderr });
    this.rlErr.on('line', (line) => {
      this.appendLog(line);
      this.broadcastLog(line);
    });
  }

  appendLog(line) {
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  /** Push a human-readable log line to attached clients (startup progress). */
  broadcastLog(line) {
    const frame = JSON.stringify({
      jsonrpc: '2.0',
      method: '$/mobileAgent/log',
      params: { sessionId: this.id, line },
    });
    this.emitToClients(frame, { buffer: false });
  }

  clearPending() {
    for (const [, entry] of this.pendingToAgent) {
      try {
        entry.ws?.close?.(1011, 'agent exited');
      } catch {
        /* ignore */
      }
    }
    this.pendingToAgent.clear();
    this.pendingToClient.clear();
    for (const [, resolveFn] of this.pendingServer) {
      try {
        resolveFn({ error: { code: -32000, message: 'agent exited' } });
      } catch {
        /* ignore */
      }
    }
    this.pendingServer.clear();
  }

  /** Write one JSON-RPC frame to the agent's stdin. */
  writeToAgent(obj) {
    if (!this.alive || !this.proc?.stdin?.writable) {
      throw new Error('agent process is not running');
    }
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /**
   * Attach a browser WebSocket to this session. Spawns the agent if it is
   * not running, replays the buffered agent->client frames, and wires up
   * message routing.
   */
  attach(ws) {
    if (!this.alive) this.start();
    this.cancelIdle();

    // Announce the server-side session id once. Emit it *before* registering
    // the new client so the buffered replay below delivers it exactly once
    // (emitting after the add would send it directly and then again on
    // replay).
    if (!this.sessionNoteSent) {
      this.sessionNoteSent = true;
      this.emitToClients(
        JSON.stringify({
          jsonrpc: '2.0',
          method: '$/mobileAgent/session',
          params: { sessionId: this.id, agentId: this.agentId, cwd: this.cwd },
        }),
        { buffer: true }
      );
    }

    this.clients.add(ws);

    // Replay buffered server notifications (session id, elicitations).
    for (const frame of this.buffer) {
      this.send(ws, frame);
    }

    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      this.onClientFrame(ws, text);
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.scheduleIdle();
    });
    ws.on('error', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.scheduleIdle();
    });
  }

  send(ws, frame) {
    try {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    } catch {
      /* ignore */
    }
  }

  /**
   * Emit a frame to all attached clients. `buffer` marks server
   * notifications (`$/mobileAgent/*`) that should be replayed to future
   * clients; agent ACP frames are never buffered (see {@link buffer}).
   */
  emitToClients(frame, { buffer = false } = {}) {
    if (buffer) {
      this.buffer.push(frame);
      if (this.buffer.length > MAX_BUFFER_FRAMES) {
        this.buffer.splice(0, this.buffer.length - MAX_BUFFER_FRAMES);
      }
    }
    for (const ws of this.clients) this.send(ws, frame);
  }

  /** Handle one inbound frame from a browser client. */
  onClientFrame(ws, text) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        console.warn(`[session ${this.id}] dropping non-JSON client frame`);
        continue;
      }
      this.routeClientMessage(ws, msg);
    }
  }

  routeClientMessage(ws, msg) {
    const hasMethod = typeof msg.method === 'string';
    const hasId = msg.id !== undefined && msg.id !== null;

    // Notification from client.
    if (hasMethod && !hasId) {
      // The client's keep-alive ping is answered by the transport layer;
      // never forward it to the agent (which would ignore it anyway).
      if (msg.method === SERVER_PING_METHOD) return;
      this.forwardToAgent(msg);
      return;
    }

    // Request from client -> allocate a fresh agent id and remember the
    // mapping so the response can be routed back to this client.
    if (hasMethod && hasId) {
      const clientId = msg.id;
      const agentId = this.nextAgentId++;
      this.pendingToAgent.set(agentId, { clientId, ws });
      this.forwardToAgent({ ...injectElicitationCapability(msg), id: agentId });
      return;
    }

    // Response from client (to an agent-originated request).
    if (!hasMethod && hasId) {
      const agentId = this.pendingToClient.get(msg.id);
      if (agentId !== undefined) {
        this.pendingToClient.delete(msg.id);
        this.forwardToAgent({ ...msg, id: agentId });
      } else {
        console.warn(
          `[session ${this.id}] client response for unknown id ${msg.id}`
        );
      }
      return;
    }
  }

  forwardToAgent(msg) {
    try {
      this.writeToAgent(msg);
    } catch (e) {
      console.warn(`[session ${this.id}] write to agent failed: ${e.message}`);
    }
  }

  /** Handle one line of the agent's stdout. */
  onAgentLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Not a JSON-RPC frame — surface it as a log line (some agents print
      // banners / diagnostics to stdout).
      this.appendLog(trimmed);
      this.broadcastLog(trimmed);
      return;
    }

    const hasMethod = typeof msg.method === 'string';
    const hasId = msg.id !== undefined && msg.id !== null;

    // Response to a server-originated request (e.g. URL elicitation).
    if (!hasMethod && hasId && this.pendingServer.has(msg.id)) {
      const resolveFn = this.pendingServer.get(msg.id);
      this.pendingServer.delete(msg.id);
      resolveFn(msg);
      return;
    }

    // Response to a client-originated request: rewrite back to the client id.
    if (!hasMethod && hasId && this.pendingToAgent.has(msg.id)) {
      const { clientId } = this.pendingToAgent.get(msg.id);
      this.pendingToAgent.delete(msg.id);
      this.emitToClients(JSON.stringify({ ...msg, id: clientId }));
      return;
    }

    // Request from agent to client: the server handles URL elicitation
    // itself (Codex device-code login); everything else is forwarded with a
    // fresh client id.
    if (hasMethod && hasId) {
      if (handleAgentRequest(this, msg)) return;
      const clientId = this.nextClientId++;
      this.pendingToClient.set(clientId, msg.id);
      this.emitToClients(JSON.stringify({ ...msg, id: clientId }));
      return;
    }

    // Notification from agent (session/update, etc.) — pass through.
    if (hasMethod && !hasId) {
      handleAgentNotification(this, msg);
      this.emitToClients(trimmed);
      return;
    }

    // Unknown / unmatched response — forward verbatim so nothing is lost.
    this.emitToClients(trimmed);
  }

  /**
   * Issue a JSON-RPC request from the server to the attached client and
   * resolve with the client's response. Used for Codex device-code login
   * (`elicitation/create`).
   */
  requestClient(method, params, timeoutMs = 300000) {
    const id = this.nextServerId--;
    return new Promise((resolveFn) => {
      const timer = setTimeout(() => {
        if (this.pendingServer.has(id)) {
          this.pendingServer.delete(id);
          resolveFn({ error: { code: -32000, message: 'client request timed out' } });
        }
      }, timeoutMs);
      this.pendingServer.set(id, (response) => {
        clearTimeout(timer);
        resolveFn(response);
      });
      this.emitToClients(
        JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        { buffer: false }
      );
    });
  }

  /** Notify clients that a server-issued elicitation is complete. */
  notifyClient(method, params) {
    this.emitToClients(
      JSON.stringify({ jsonrpc: '2.0', method, params }),
      { buffer: false }
    );
  }

  scheduleIdle() {
    if (this.idleTimeoutMs <= 0) return;
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      if (this.clients.size === 0) {
        console.log(
          `[session ${this.id}] idle for ${this.idleTimeoutMs}ms with no clients; stopping agent`
        );
        this.dispose('idle timeout');
        this.manager.sessions.delete(this.id);
        this.manager.persist();
      }
    }, this.idleTimeoutMs);
    // Don't keep the Node event loop alive solely for the idle timer.
    this.idleTimer.unref?.();
  }

  cancelIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  dispose(reason) {
    this.cancelIdle();
    for (const ws of this.clients) {
      try {
        ws.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.rl?.close();
    this.rlErr?.close();
    this.clearPending();
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
    this.alive = false;
  }
}

export { Session };
