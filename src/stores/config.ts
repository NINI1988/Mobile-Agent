// Agent configuration store with hot-reload support
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AgentsConfig, AgentConfig, AgentTransportKind } from '../lib/types';
import { getTransportKind } from '../lib/types';
import { restrictedTransports } from '../lib/platform';
import { getConfig, reloadConfig, getConfigPath, onConfigChanged } from '../lib/host';
import { fetchServerConfig } from '../lib/server';

export const useConfigStore = defineStore('config', () => {
  const config = ref<AgentsConfig>({ agents: {} });
  const configPath = ref<string>('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  // True once the Mobile Agent server has been reached and its agents merged.
  const serverAvailable = ref(false);
  // Working directory / default agent advertised by the Mobile Agent server.
  const serverCwd = ref('');
  const serverDefaultAgent = ref('');

  // Stdio agents are listed in the raw config but cannot run on mobile or
  // web builds (no subprocess). Filter them out so the UI never offers an
  // option that immediately fails.
  const allAgentNames = computed(() => Object.keys(config.value.agents));

  const agentNames = computed(() => {
    if (!restrictedTransports()) return allAgentNames.value;
    return allAgentNames.value.filter(
      (name) => getTransportKind(config.value.agents[name]) !== 'stdio'
    );
  });

  const hasAgents = computed(() => agentNames.value.length > 0);

  /** Transport kind for an agent (defaults to 'stdio' for unknown names). */
  function getAgentTransportKind(name: string): AgentTransportKind {
    const c = config.value.agents[name];
    return c ? getTransportKind(c) : 'stdio';
  }

  const stdioAgentNames = computed(() =>
    allAgentNames.value.filter(
      (name) => getTransportKind(config.value.agents[name]) === 'stdio'
    )
  );

  const remoteAgentNames = computed(() =>
    allAgentNames.value.filter((name) => {
      const k = getTransportKind(config.value.agents[name]);
      return k === 'websocket' || k === 'http';
    })
  );

  async function loadConfig() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await getConfig();
      configPath.value = await getConfigPath();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
    // Merge agents advertised by the Mobile Agent server (if present). This
    // is what makes `npm start` work with zero client-side configuration.
    await loadServerAgents();
  }

  /**
   * Fetch agents from the Mobile Agent server and merge them into the config.
   *
   * Server agents are modelled as `websocket` transports whose URL is filled
   * in per-session (the session store appends `?agent=...&session=...&cwd=...`).
   * User-defined agents with the same key win, so a manual override is always
   * possible.
   */
  async function loadServerAgents() {
    try {
      const server = await fetchServerConfig();
      if (server.agents.length === 0) return;
      const merged: AgentsConfig = { agents: { ...config.value.agents } };
      for (const agent of server.agents) {
        const key = agent.name || agent.id;
        if (merged.agents[key]) continue; // don't clobber user config
        merged.agents[key] = {
          transport: 'websocket',
          url: '', // resolved at connect time from the session store
          serverAgentId: agent.id,
          serverName: agent.name,
        };
      }
      config.value = merged;
      serverAvailable.value = true;
      serverCwd.value = server.cwd;
      // Expose the default agent as its config key (the display name), which
      // is what the UI selects.
      const defaultEntry = server.agents.find((a) => a.id === server.defaultAgent);
      serverDefaultAgent.value = defaultEntry
        ? defaultEntry.name || defaultEntry.id
        : '';
    } catch (e) {
      // Server not reachable (e.g. hosted web build) — that's fine; the app
      // still works with user-configured remote agents.
      console.debug('Mobile Agent server not available:', e);
    }
  }

  async function reload() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await reloadConfig();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function getAgent(name: string): AgentConfig | undefined {
    return config.value.agents[name];
  }

  // Set up hot-reload listener
  async function setupHotReload() {
    await onConfigChanged((newConfig) => {
      config.value = newConfig;
      console.log('Config hot-reloaded:', newConfig);
    });
  }

  // Update config from event (for settings updates)
  function updateFromEvent(newConfig: AgentsConfig) {
    config.value = newConfig;
  }

  function clearError() {
    error.value = null;
  }

  return {
    config,
    configPath,
    loading,
    error,
    serverAvailable,
    serverCwd,
    serverDefaultAgent,
    agentNames,
    allAgentNames,
    stdioAgentNames,
    remoteAgentNames,
    hasAgents,
    getAgentTransportKind,
    loadConfig,
    reload,
    getAgent,
    setupHotReload,
    updateFromEvent,
    clearError,
  };
});
