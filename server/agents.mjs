// Agent registry for the Mobile Agent server.
//
// An "agent" is a local ACP agent process (a command that speaks the Agent
// Client Protocol over stdio). The registry is intentionally tiny: a plain
// object of id -> { name, command, args, env, cwd }. Agents can be supplied
// via `MOBILE_AGENT_AGENTS` (JSON), a `.mobile-agent/agents.json` file, or
// fall back to the built-in Codex default.
//
// This is deliberately NOT a plugin system — adding a new agent is a matter
// of adding one entry. Later, per-agent capabilities can be layered on top
// without changing the shape.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Built-in default agent. Codex is the first supported agent; the
 * `@agentclientprotocol/codex-acp` adapter bundles a compatible Codex
 * binary as a dependency so `npx -y` is all that's needed.
 *
 * `NO_BROWSER=1` hides the browser-callback ChatGPT auth method (which
 * cannot complete in a headless Codespace) while keeping the device-code
 * method available — exactly the flow we surface in the GUI.
 */
const DEFAULT_AGENTS = {
  codex: {
    name: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp@latest'],
    env: { NO_BROWSER: '1' },
  },
};

/** Convert an arbitrary agent name into a URL-safe id. */
export function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

/**
 * Normalise one raw agent entry into the canonical shape and validate the
 * minimum required fields.
 */
function normalizeAgent(id, raw, defaultCwd) {
  if (!raw || typeof raw !== 'object') return null;
  const command = raw.command;
  if (typeof command !== 'string' || command.trim() === '') return null;

  const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
  const env =
    raw.env && typeof raw.env === 'object'
      ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)]))
      : {};

  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
    command,
    args,
    env,
    cwd:
      typeof raw.cwd === 'string' && raw.cwd.trim()
        ? resolve(raw.cwd)
        : defaultCwd,
  };
}

/** Read a JSON file, returning null on any failure. */
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[agents] Failed to read ${path}: ${e.message}`);
    return null;
  }
}

/**
 * Load the agent registry.
 *
 * Precedence (highest first):
 *   1. `MOBILE_AGENT_AGENTS` env var (JSON object)
 *   2. `.mobile-agent/agents.json` in the workspace
 *   3. built-in defaults
 *
 * `MOBILE_AGENT_AGENT` selects which agent is the default / auto-start one.
 */
export function loadAgents({ cwd, env = process.env } = {}) {
  const defaultCwd = resolve(env.MOBILE_AGENT_CWD || cwd || process.cwd());

  let source = null;
  if (env.MOBILE_AGENT_AGENTS) {
    try {
      source = JSON.parse(env.MOBILE_AGENT_AGENTS);
    } catch (e) {
      console.warn(`[agents] MOBILE_AGENT_AGENTS is not valid JSON: ${e.message}`);
    }
  }
  if (!source) {
    const file = readJson(resolve(defaultCwd, '.mobile-agent', 'agents.json'));
    if (file) source = file;
  }
  if (!source) source = DEFAULT_AGENTS;

  // Accept both `{ agents: {...} }` and a bare `{ id: {...} }` object.
  const entries =
    source.agents && typeof source.agents === 'object' ? source.agents : source;

  const agents = {};
  for (const [rawId, raw] of Object.entries(entries)) {
    const id = slugify(rawId);
    const agent = normalizeAgent(id, raw, defaultCwd);
    if (agent) agents[id] = agent;
    else console.warn(`[agents] Skipping invalid agent entry '${rawId}'`);
  }

  const ids = Object.keys(agents);
  const requested = env.MOBILE_AGENT_AGENT ? slugify(env.MOBILE_AGENT_AGENT) : null;
  const defaultAgent = requested && agents[requested] ? requested : ids[0] ?? null;

  return { agents, defaultAgent, cwd: defaultCwd };
}
