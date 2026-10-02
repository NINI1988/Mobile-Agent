// Device-code authentication support.
//
// Codex (via `@agentclientprotocol/codex-acp`) advertises a
// `chat-gpt-device-code` auth method only when the ACP client declares the
// URL-elicitation capability during `initialize`. When the user picks that
// method, the agent issues an `elicitation/create` JSON-RPC *request* to the
// client containing the verification URL and a one-time code embedded in a
// human-readable message.
//
// Instead of teaching the browser bridge the elicitation wire format, the
// server acts as the elicitation client for the URL flow:
//   - it injects `elicitation: { url: {} }` into the client's `initialize`,
//   - answers `elicitation/create` (mode=url) with `accept`, and
//   - pushes a `$/mobileAgent/elicitation` notification to the GUI so it can
//     show the link + code with a copy button.
//
// Other elicitation modes (forms) are left to the normal forwarding path.

/** ACP auth method id advertised by codex-acp for the device-code flow. */
export const DEVICE_CODE_AUTH_METHOD = 'chat-gpt-device-code';

/**
 * Ensure the client's `initialize` request advertises URL elicitation so the
 * agent offers the device-code auth method. Preserves any capabilities the
 * browser already sent (e.g. fs read/write flags).
 */
export function injectElicitationCapability(msg) {
  if (!msg || msg.method !== 'initialize' || !msg.params) return msg;
  const caps = msg.params.clientCapabilities ?? {};
  if (caps.elicitation?.url != null) return msg;
  return {
    ...msg,
    params: {
      ...msg.params,
      clientCapabilities: {
        ...caps,
        elicitation: { ...(caps.elicitation ?? {}), url: {} },
      },
    },
  };
}

/**
 * Extract the one-time device code from an elicitation message.
 * Codex formats it as e.g. "Sign in to ChatGPT and enter this code: ABCD-EFGH".
 * Accepts any `XXXX-XXXX` style token with 4+ alphanumerics per side.
 */
export function parseDeviceCode(message) {
  if (typeof message !== 'string') return null;
  const m = message.match(/\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/);
  return m ? m[1] : null;
}

/**
 * Try to handle an agent->client request at the server level.
 *
 * @returns {boolean} true if the request was fully handled here (and must
 *   NOT be forwarded to the browser client).
 */
export function handleAgentRequest(session, msg) {
  if (msg.method !== 'elicitation/create') return false;
  const params = msg.params ?? {};
  if (params.mode !== 'url') return false;

  const code = parseDeviceCode(params.message);
  // Tell the GUI to show the verification page + code.
  session.notifyClient('$/mobileAgent/elicitation', {
    sessionId: session.id,
    elicitationId: params.elicitationId ?? null,
    url: params.url ?? null,
    code,
    message: params.message ?? '',
  });

  // `accept` means "the client displayed the URL to the user"; the actual
  // sign-in happens in the browser and completion arrives asynchronously.
  session.forwardToAgent({
    jsonrpc: '2.0',
    id: msg.id,
    result: { action: 'accept' },
  });
  return true;
}

/**
 * Handle an agent notification that an elicitation finished (e.g. the user
 * completed the device-code login). Forwarded to the GUI so it can dismiss
 * the auth card.
 *
 * @returns {boolean} true if handled here.
 */
export function handleAgentNotification(session, msg) {
  if (msg.method !== 'elicitation/complete') return false;
  session.notifyClient('$/mobileAgent/elicitationComplete', {
    sessionId: session.id,
    elicitationId: msg.params?.elicitationId ?? null,
  });
  return false; // also let it flow through the normal notification path
}
