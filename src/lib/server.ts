// Helpers for talking to the Mobile Agent server (server/index.mjs).
//
// The server exposes a tiny JSON API and a WebSocket ACP bridge. When the
// web app is served *by* that server, everything is same-origin and no
// configuration is required. When the app is served elsewhere (e.g. the Vite
// dev server on :5173), the server base URL can be overridden with
// `VITE_MOBILE_AGENT_SERVER`.

/** A configured agent as advertised by `GET /api/agents`. */
export interface ServerAgent {
  id: string;
  name: string;
  cwd: string;
}

export interface ServerConfig {
  agents: ServerAgent[];
  defaultAgent: string | null;
  cwd: string;
}

/**
 * Base URL of the Mobile Agent server, without a trailing slash.
 *
 * Defaults to the current origin (same-origin when served by the server).
 * The Vite dev server proxies `/api` and `/ws` to the server, so the default
 * also works during `npm run dev:server`.
 */
export function serverBaseUrl(): string {
  const override = (import.meta.env as Record<string, string | undefined>)
    .VITE_MOBILE_AGENT_SERVER;
  if (override) return override.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/** WebSocket URL of the ACP bridge for a given agent / session / cwd. */
export function serverWsUrl(opts: {
  agent?: string;
  session?: string;
  cwd?: string;
}): string {
  const base = serverBaseUrl().replace(/^http/, 'ws');
  const params = new URLSearchParams();
  if (opts.agent) params.set('agent', opts.agent);
  if (opts.session) params.set('session', opts.session);
  if (opts.cwd) params.set('cwd', opts.cwd);
  const qs = params.toString();
  return `${base}/ws${qs ? `?${qs}` : ''}`;
}

/** Fetch the server's agent list. Throws when the server is unreachable. */
export async function fetchServerConfig(): Promise<ServerConfig> {
  const res = await fetch(`${serverBaseUrl()}/api/agents`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  const data = (await res.json()) as Partial<ServerConfig>;
  return {
    agents: Array.isArray(data.agents) ? data.agents : [],
    defaultAgent: data.defaultAgent ?? null,
    cwd: data.cwd ?? '',
  };
}

/** Ask the server to forget a session. Best-effort. */
export async function deleteServerSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${serverBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  } catch {
    /* ignore */
  }
}
