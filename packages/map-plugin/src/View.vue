<script setup lang="ts">
// PR-B view (#1227): interactive Google Map + favorites flow.
//
// Three states branched on `viewState`:
//   - "loading"       — fetching status / api-key from the server
//   - "unconfigured"  — no API key set; shows the Settings prompt
//   - "ready"         — SDK loaded, map mounted, favorites rendered
//
// Right-click on the map (or long-press on touch) opens a name
// prompt; submitting calls `addFavorite`. Clicking a pin opens the
// detail panel (name / lat-lng / tags / notes / Remove). Tag chips
// in the header filter the visible pins (multi-select = OR).
//
// SDK is loaded lazily via the module-scoped Promise cache in
// `./mapsLoader.ts`, so a second mount inside the same SPA session
// (e.g. after a route change to /map and back) reuses the cached
// `google` global without re-injecting the script or re-billing.

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";
import { loadMapsSdk } from "./mapsLoader";
import type { Favorite } from "./favorites";

interface StatusResult {
  ok: boolean;
  configured?: boolean;
}
interface ApiKeyResult {
  ok: boolean;
  apiKey?: string;
}
interface ListFavoritesResult {
  ok: boolean;
  favorites?: Favorite[];
}
interface AddFavoriteResult {
  ok: boolean;
  favorite?: Favorite;
}
interface RemoveFavoriteResult {
  ok: boolean;
  error?: string;
}

// `google.maps.*` runtime types (loosely typed — see mapsLoader.ts
// for the rationale). Using `unknown` everywhere works but makes
// the call sites unreadable; this `MapsApi` shape captures only the
// surface we actually touch.
interface LatLngLiteral {
  lat: number;
  lng: number;
}
interface MapsMarker {
  setMap: (map: MapsMap | null) => void;
  addListener: (event: string, handler: (e?: unknown) => void) => void;
}
interface MapsMap {
  panTo: (latLng: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  addListener: (event: string, handler: (e: { latLng?: { lat: () => number; lng: () => number } }) => void) => void;
}
interface MapsApi {
  Map: new (el: HTMLElement, opts: object) => MapsMap;
  Marker: new (opts: object) => MapsMarker;
}

const TOKYO_STATION: LatLngLiteral = { lat: 35.6812, lng: 139.7671 };
const DEFAULT_ZOOM = 13;
const PIN_FOCUS_ZOOM = 16;

const { pubsub, dispatch, log } = useRuntime();
const t = useT();

type ViewState = "loading" | "unconfigured" | "ready";
const viewState = ref<ViewState>("loading");
const errorMessage = ref<string>("");

const favorites = ref<Favorite[]>([]);
const selectedId = ref<string | null>(null);
const selected = computed<Favorite | null>(() => favorites.value.find((f) => f.id === selectedId.value) ?? null);

// Tag filter chips — empty Set means "show all".
const activeTags = ref<Set<string>>(new Set());
const knownTags = computed<string[]>(() => {
  const tags = new Set<string>();
  for (const f of favorites.value) for (const tag of f.tags ?? []) tags.add(tag);
  return [...tags].sort();
});
const visibleFavorites = computed<Favorite[]>(() => {
  if (activeTags.value.size === 0) return favorites.value;
  return favorites.value.filter((f) => (f.tags ?? []).some((tag) => activeTags.value.has(tag)));
});

const mapEl = ref<HTMLDivElement | null>(null);
let mapInstance: MapsMap | null = null;
let mapsApi: MapsApi | null = null;
const markers = new Map<string, MapsMarker>();

async function bootstrap(): Promise<void> {
  try {
    const status = await dispatch<StatusResult>({ kind: "status" });
    if (!status.configured) {
      viewState.value = "unconfigured";
      return;
    }
    const keyResult = await dispatch<ApiKeyResult>({ kind: "getApiKey" });
    if (!keyResult.ok || !keyResult.apiKey) {
      viewState.value = "unconfigured";
      return;
    }
    mapsApi = (await loadMapsSdk(keyResult.apiKey)) as MapsApi;
    viewState.value = "ready";
    await refetchFavorites();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
    log.warn("bootstrap failed", { error: errorMessage.value });
  }
}

function ensureMap(): MapsMap | null {
  if (mapInstance || !mapsApi || !mapEl.value) return mapInstance;
  mapInstance = new mapsApi.Map(mapEl.value, {
    center: TOKYO_STATION,
    zoom: DEFAULT_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  mapInstance.addListener("rightclick", (e) => {
    if (!e.latLng) return;
    void onMapRightClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  });
  return mapInstance;
}

function clearMarkers(): void {
  for (const marker of markers.values()) marker.setMap(null);
  markers.clear();
}

function renderMarkers(items: Favorite[]): void {
  if (!mapsApi || !mapInstance) return;
  clearMarkers();
  for (const fav of items) {
    const marker = new mapsApi.Marker({
      position: { lat: fav.lat, lng: fav.lng },
      map: mapInstance,
      title: fav.name,
    });
    marker.addListener("click", () => {
      selectedId.value = fav.id;
      mapInstance?.panTo({ lat: fav.lat, lng: fav.lng });
      mapInstance?.setZoom(PIN_FOCUS_ZOOM);
    });
    markers.set(fav.id, marker);
  }
}

async function refetchFavorites(): Promise<void> {
  try {
    const result = await dispatch<ListFavoritesResult>({ kind: "listFavorites" });
    favorites.value = result.favorites ?? [];
    if (viewState.value === "ready") {
      ensureMap();
      renderMarkers(visibleFavorites.value);
    }
  } catch (err) {
    log.warn("listFavorites failed", { error: String(err) });
  }
}

async function onMapRightClick(at: LatLngLiteral): Promise<void> {
  // Native prompt is intentionally crude for PR-B — PR-C replaces it
  // with the Places autocomplete UX where the user picks a result and
  // the name comes from Google. A custom modal here would be wasted
  // work; we just need the round-trip to prove the storage path.
  const name = window.prompt(t.value.addPromptName);
  if (!name || name.trim().length === 0) return;
  const tagsRaw = window.prompt(t.value.addPromptTags) ?? "";
  const tags = tagsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  try {
    const result = await dispatch<AddFavoriteResult>({
      kind: "addFavorite",
      name: name.trim(),
      lat: at.lat,
      lng: at.lng,
      tags: tags.length > 0 ? tags : undefined,
    });
    if (result.ok && result.favorite) selectedId.value = result.favorite.id;
  } catch (err) {
    log.warn("addFavorite failed", { error: String(err) });
  }
}

async function onRemove(id: string): Promise<void> {
  try {
    const result = await dispatch<RemoveFavoriteResult>({ kind: "removeFavorite", id });
    if (result.ok && selectedId.value === id) selectedId.value = null;
  } catch (err) {
    log.warn("removeFavorite failed", { error: String(err) });
  }
}

function toggleTag(tag: string): void {
  const next = new Set(activeTags.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  activeTags.value = next;
}

function clearTags(): void {
  activeTags.value = new Set();
}

// Re-render markers when the filter chips change without re-fetching
// from the server — purely client-side.
watch(visibleFavorites, (next) => {
  if (viewState.value === "ready") renderMarkers(next);
});

let unsubFavorites: (() => void) | null = null;
let unsubConfig: (() => void) | null = null;

onMounted(() => {
  void bootstrap();
  unsubFavorites = pubsub.subscribe("favorites-changed", () => void refetchFavorites());
  unsubConfig = pubsub.subscribe("configured-changed", () => void bootstrap());
});

onUnmounted(() => {
  unsubFavorites?.();
  unsubConfig?.();
  clearMarkers();
});
</script>

<template>
  <div class="map-plugin-root">
    <header>
      <h1>{{ t.title }}</h1>
      <span v-if="viewState === 'ready'" class="count">
        {{ t.favoritesCount({ count: favorites.length }) }}
      </span>
    </header>

    <div v-if="viewState === 'loading'" class="message loading">{{ t.loading }}</div>

    <div v-else-if="viewState === 'unconfigured'" class="message prompt">
      <p>{{ t.configurePrompt }}</p>
      <p class="hint">{{ t.configureHint }}</p>
    </div>

    <template v-else>
      <div v-if="knownTags.length > 0" class="tag-bar" data-testid="map-tag-bar">
        <button type="button" class="tag-chip" :class="{ active: activeTags.size === 0 }" data-testid="map-tag-chip-all" @click="clearTags">
          {{ t.allTagsChip }}
        </button>
        <button
          v-for="tag in knownTags"
          :key="tag"
          type="button"
          class="tag-chip"
          :class="{ active: activeTags.has(tag) }"
          :data-testid="`map-tag-chip-${tag}`"
          @click="toggleTag(tag)"
        >
          #{{ tag }}
        </button>
      </div>

      <div class="map-area">
        <div ref="mapEl" class="map-canvas" data-testid="map-canvas" />

        <aside v-if="selected" class="detail-panel" data-testid="map-detail-panel">
          <header class="detail-header">
            <h2>{{ selected.name }}</h2>
            <button type="button" class="close-btn" :title="t.closeDetail" @click="selectedId = null">×</button>
          </header>
          <p class="coords">{{ selected.lat.toFixed(5) }}, {{ selected.lng.toFixed(5) }}</p>
          <p v-if="selected.tags && selected.tags.length > 0" class="tags">
            <span v-for="tag in selected.tags" :key="tag" class="tag">#{{ tag }}</span>
          </p>
          <p v-if="selected.notes" class="notes">{{ selected.notes }}</p>
          <button type="button" class="remove-btn" data-testid="map-remove-btn" @click="onRemove(selected.id)">
            {{ t.removeFavorite }}
          </button>
        </aside>
      </div>

      <p v-if="favorites.length === 0" class="hint-empty">{{ t.emptyHint }}</p>
    </template>

    <div v-if="errorMessage" class="message error">{{ errorMessage }}</div>
  </div>
</template>

<style scoped>
.map-plugin-root {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  font-family: system-ui, sans-serif;
}
header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem 0;
}
header h1 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: #1f2937;
}
.count {
  font-size: 0.75rem;
  color: #6b7280;
}
.tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0 1rem;
}
.tag-chip {
  font-size: 0.75rem;
  padding: 0.125rem 0.625rem;
  border-radius: 9999px;
  border: 1px solid #d1d5db;
  background: white;
  color: #374151;
  cursor: pointer;
}
.tag-chip:hover {
  background: #f3f4f6;
}
.tag-chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: white;
}
.map-area {
  position: relative;
  flex: 1;
  margin: 0 1rem 1rem;
}
.map-canvas {
  width: 100%;
  height: 100%;
  min-height: 320px;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
}
.detail-panel {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 240px;
  max-width: calc(100% - 1rem);
  padding: 0.75rem;
  background: white;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 0.875rem;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0;
}
.detail-header h2 {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
  word-break: break-word;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.125rem;
  cursor: pointer;
  color: #9ca3af;
  line-height: 1;
}
.close-btn:hover {
  color: #1f2937;
}
.coords {
  font-family: monospace;
  font-size: 0.75rem;
  color: #6b7280;
  margin: 0.5rem 0;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0.5rem 0;
}
.tag {
  font-size: 0.6875rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  background: #f3f4f6;
  color: #4b5563;
}
.notes {
  margin: 0.5rem 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.remove-btn {
  margin-top: 0.5rem;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
  border-radius: 0.25rem;
  cursor: pointer;
}
.remove-btn:hover {
  background: #fecaca;
}
.message {
  padding: 0.75rem 1rem;
  margin: 0 1rem;
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
.message.error {
  background: #fee2e2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
.message p {
  margin: 0;
}
.hint {
  margin-top: 0.5rem !important;
  font-size: 0.8125rem;
  opacity: 0.85;
}
.hint-empty {
  font-size: 0.8125rem;
  color: #6b7280;
  padding: 0 1rem 0.75rem;
  margin: 0;
}
</style>
