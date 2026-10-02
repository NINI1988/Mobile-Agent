<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ElicitationInfo } from '../lib/types';

const props = defineProps<{
  elicitation: ElicitationInfo;
}>();

const emit = defineEmits<{
  (e: 'dismiss'): void;
}>();

const copied = ref(false);

// Human-readable text with the code stripped out, so we can show the code
// separately in its own copyable box.
const description = computed(() => {
  let msg = props.elicitation.message || '';
  if (props.elicitation.code) {
    msg = msg.replace(props.elicitation.code, '').replace(/:\s*$/, '').trim();
  }
  return msg || 'Sign in to continue.';
});

async function copyCode() {
  const code = props.elicitation.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard API can be blocked in non-secure contexts; the user can
    // still select the code manually.
    copied.value = false;
  }
}

function openUrl() {
  if (props.elicitation.url) window.open(props.elicitation.url, '_blank', 'noopener');
}
</script>

<template>
  <div class="elicitation-overlay" @click.self="emit('dismiss')">
    <div class="elicitation-card">
      <div class="card-header">
        <span class="badge">Sign in</span>
        <button class="close-btn" @click="emit('dismiss')" aria-label="Dismiss">✕</button>
      </div>

      <p class="description">{{ description }}</p>

      <div v-if="elicitation.code" class="code-block">
        <span class="code-label">One-time code</span>
        <button class="code-value" @click="copyCode" :title="copied ? 'Copied' : 'Tap to copy'">
          <span class="code-text">{{ elicitation.code }}</span>
          <span class="copy-hint">{{ copied ? '✓ Copied' : '⧉ Copy' }}</span>
        </button>
      </div>

      <button v-if="elicitation.url" class="open-btn" @click="openUrl">
        Open sign-in page →
      </button>
      <a
        v-if="elicitation.url"
        class="url-link"
        :href="elicitation.url"
        target="_blank"
        rel="noopener noreferrer"
      >{{ elicitation.url }}</a>

      <p class="hint">
        This page opens in a new tab. Enter the code there, then return here —
        the agent continues automatically once you are signed in.
      </p>
    </div>
  </div>
</template>

<style scoped>
.elicitation-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1100;
}

@media (min-width: 600px) {
  .elicitation-overlay {
    align-items: center;
  }
}

.elicitation-card {
  width: 100%;
  max-width: 440px;
  background: var(--bg-main, #252525);
  border-radius: 16px 16px 0 0;
  padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
}

@media (min-width: 600px) {
  .elicitation-card {
    border-radius: 16px;
    padding-bottom: 1.25rem;
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.badge {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-accent, #4da6ff);
  background: rgba(77, 166, 255, 0.12);
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.close-btn {
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: 1.1rem;
  cursor: pointer;
  min-width: 40px;
  min-height: 40px;
}

.description {
  margin: 0 0 1rem;
  color: var(--text-primary, #e0e0e0);
  line-height: 1.5;
}

.code-block {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.code-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
}

.code-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.85rem 1rem;
  border: 1px dashed var(--border-color, #404040);
  border-radius: 10px;
  background: var(--bg-assistant, #2d2d2d);
  cursor: pointer;
}

.code-text {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-primary, #fff);
}

.copy-hint {
  font-size: 0.8rem;
  color: var(--text-accent, #4da6ff);
  white-space: nowrap;
}

.open-btn {
  width: 100%;
  min-height: 48px;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 10px;
  background: var(--bg-primary, #0066cc);
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.open-btn:hover {
  background: var(--bg-primary-hover, #0052a3);
}

.url-link {
  display: block;
  margin-top: 0.6rem;
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  word-break: break-all;
  text-align: center;
}

.hint {
  margin: 1rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted, #888);
  line-height: 1.45;
}
</style>
