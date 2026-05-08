<script setup lang="ts">
// PR-A view (#1227): empty placeholder.
//
// When no API key is set → "Configure Google Maps API key in
// Settings" prompt with a deep link.
// When configured → a green "✓ Configured" badge plus a placeholder
// for the future map. The actual map mount lands in PR-B alongside
// the favorites flow; PR-A only proves the configure round-trip.
//
// Strings are gated through a small `useT()` shim so PR-D's
// localisation work doesn't have to walk every string back through
// templates again.

import { onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";

interface StatusResult {
  ok?: boolean;
  configured?: boolean;
}

const { pubsub, dispatch, log } = useRuntime();
const t = useT();

const configured = ref<boolean>(false);
const loading = ref<boolean>(true);

async function refetch(): Promise<void> {
  try {
    const result = await dispatch<StatusResult>({ kind: "status" });
    configured.value = Boolean(result?.configured);
  } catch (err) {
    log.warn("status fetch failed", { error: String(err) });
  } finally {
    loading.value = false;
  }
}

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  void refetch();
  unsubscribe = pubsub.subscribe("configured-changed", () => void refetch());
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <div class="map-plugin-root">
    <header>
      <h1>{{ t.title }}</h1>
      <span v-if="!loading && configured" class="badge configured">{{ t.badgeConfigured }}</span>
      <span v-else-if="!loading" class="badge unconfigured">{{ t.badgeUnconfigured }}</span>
    </header>

    <div v-if="loading" class="message loading">{{ t.loading }}</div>

    <div v-else-if="!configured" class="message prompt">
      <p>{{ t.configurePrompt }}</p>
      <p class="hint">{{ t.configureHint }}</p>
    </div>

    <div v-else class="message ok">
      <p>{{ t.readyTitle }}</p>
      <p class="hint">{{ t.readyHint }}</p>
    </div>
  </div>
</template>

<style scoped>
.map-plugin-root {
  padding: 1rem 1.25rem;
  font-family: system-ui, sans-serif;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
}
header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
header h1 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: #1f2937;
}
.badge {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-weight: 500;
}
.badge.configured {
  background: #d1fae5;
  color: #065f46;
}
.badge.unconfigured {
  background: #fef3c7;
  color: #92400e;
}
.message {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
.message.loading {
  color: #6b7280;
}
.message.prompt {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}
.message.ok {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}
.message p {
  margin: 0;
}
.hint {
  margin-top: 0.5rem !important;
  font-size: 0.8125rem;
  opacity: 0.85;
}
</style>
