<template>
  <!-- Settings tab for the @mulmoclaude/map-plugin Google Maps API key.
       Mirrors the layout and i18n conventions of SettingsMcpTab. The
       Map plugin's own /map view shows a "Configure in Settings →
       Map" prompt that points users here. (#1227 PR-A) -->
  <div class="space-y-3">
    <p class="text-xs text-gray-600 leading-relaxed">{{ t("settingsMapTab.explanation") }}</p>

    <label class="block">
      <span class="text-xs font-semibold text-gray-700">{{ t("settingsMapTab.apiKeyLabel") }}</span>
      <input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('settingsMapTab.apiKeyPlaceholder')"
        class="mt-1 w-full px-2 py-1.5 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        data-testid="settings-map-api-key-input"
        @keydown.stop
      />
    </label>

    <p class="text-[11px] text-gray-500">
      <a
        href="https://console.cloud.google.com/google/maps-apis/credentials"
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-blue-600 hover:underline"
      >
        {{ t("settingsMapTab.consoleLink") }}
      </a>
      <span class="mx-2 text-gray-300">·</span>
      <span>{{ t("settingsMapTab.requiredApis") }}</span>
    </p>

    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
        :disabled="saving || apiKey.trim().length === 0"
        data-testid="settings-map-save-btn"
        @click="save"
      >
        {{ saving ? t("settingsModal.saving") : t("common.save") }}
      </button>

      <span v-if="configured" class="text-xs text-green-700 inline-flex items-center gap-1" data-testid="settings-map-configured">
        <span class="material-icons text-sm">check_circle</span>
        {{ t("settingsMapTab.configured") }}
      </span>

      <span v-else-if="!loading" class="text-xs text-amber-700" data-testid="settings-map-unconfigured">
        {{ t("settingsMapTab.notConfigured") }}
      </span>

      <span v-if="errorMessage" class="text-xs text-red-700" data-testid="settings-map-error">{{ errorMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

const apiKey = ref("");
const configured = ref(false);
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");

const PKG = "@mulmoclaude/map-plugin";

interface DispatchResult {
  ok?: boolean;
  configured?: boolean;
}

// Substitute `:pkg` in the runtime-dispatch route URL.
// `encodeURIComponent` collapses scoped names (`@org/pkg`) into one
// URL path segment; the parameter pattern `:pkg` matches any segment.
const DISPATCH_URL = API_ROUTES.plugins.runtimeDispatch.replace(":pkg", encodeURIComponent(PKG));

async function dispatch(body: { kind: string; apiKey?: string }): Promise<DispatchResult> {
  const response = await apiPost<DispatchResult>(DISPATCH_URL, body);
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}

async function refresh(): Promise<void> {
  errorMessage.value = "";
  try {
    const result = await dispatch({ kind: "status" });
    configured.value = Boolean(result.configured);
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  const key = apiKey.value.trim();
  if (key.length === 0) return;
  saving.value = true;
  errorMessage.value = "";
  try {
    const result = await dispatch({ kind: "configure", apiKey: key });
    if (!result.ok) throw new Error(t("settingsMapTab.saveFailed"));
    apiKey.value = "";
    await refresh();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>
