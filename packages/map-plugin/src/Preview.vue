<script setup lang="ts">
// Chat-row preview for map tool calls.
//
// Three render modes branched on `selectedResult` shape:
//   - addFavorite confirmation → text + small pin map (1 marker)
//   - listFavorites overview   → text + small overview map (N pins)
//   - everything else (status / configure / removeFavorite)  → text only
//
// The preview Map is read-only: no controls, no drag, no zoom. A
// click anywhere on the preview is the user's signal to expand to
// the full canvas View — handled by the surrounding chat row, this
// component just renders.
//
// SDK is loaded via the same module-scoped Promise cache as the View
// (mapsLoader.ts), so a chat with N map tool calls causes one SDK
// load and N Map instances. Tab-key fetched from the server via
// `getApiKey`. If the key isn't set we silently render text-only
// and let the View prompt the user to configure.

import { onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";
import { loadMapsSdk } from "./mapsLoader";
import type { Favorite } from "./favorites";

interface AddFavoriteResult {
  ok?: boolean;
  favorite?: Favorite;
}
interface ListFavoritesResult {
  ok?: boolean;
  favorites?: Favorite[];
}
interface ApiKeyResult {
  ok?: boolean;
  apiKey?: string;
}

interface LatLngLiteral {
  lat: number;
  lng: number;
}
interface MapsMarker {
  setMap: (map: unknown) => void;
}
interface MapsMap {
  fitBounds: (bounds: unknown) => void;
}
interface LatLngBounds {
  extend: (latLng: LatLngLiteral) => void;
}
interface MapsApi {
  Map: new (el: HTMLElement, opts: object) => MapsMap;
  Marker: new (opts: object) => MapsMarker;
  LatLngBounds: new () => LatLngBounds;
}

const PREVIEW_DEFAULT_ZOOM = 15;
const PREVIEW_OVERVIEW_FALLBACK_ZOOM = 6;

export interface Props {
  selectedResult: AddFavoriteResult & ListFavoritesResult;
}
const props = defineProps<Props>();

const { dispatch, log } = useRuntime();
const t = useT();

const mapEl = ref<HTMLDivElement | null>(null);
const ready = ref<boolean>(false);
const errorState = ref<boolean>(false);

// Derive the points to render. addFavorite → [favorite]; list → all.
function pointsToRender(): Favorite[] {
  if (props.selectedResult.favorite) return [props.selectedResult.favorite];
  if (props.selectedResult.favorites) return props.selectedResult.favorites;
  return [];
}

let markers: MapsMarker[] = [];

async function bootstrap(): Promise<void> {
  const points = pointsToRender();
  if (points.length === 0) return;
  try {
    const keyResult = await dispatch<ApiKeyResult>({ kind: "getApiKey" });
    if (!keyResult.ok || !keyResult.apiKey) {
      errorState.value = true;
      return;
    }
    const mapsApi = (await loadMapsSdk(keyResult.apiKey)) as MapsApi;
    if (!mapEl.value) return;
    const map = new mapsApi.Map(mapEl.value, {
      center: { lat: points[0].lat, lng: points[0].lng },
      zoom: points.length === 1 ? PREVIEW_DEFAULT_ZOOM : PREVIEW_OVERVIEW_FALLBACK_ZOOM,
      // Preview is read-only — kill every interactive affordance.
      disableDefaultUI: true,
      gestureHandling: "none",
      keyboardShortcuts: false,
      clickableIcons: false,
    });
    if (points.length > 1) {
      const bounds = new mapsApi.LatLngBounds();
      for (const p of points) bounds.extend({ lat: p.lat, lng: p.lng });
      map.fitBounds(bounds);
    }
    markers = points.map(
      (p) =>
        new mapsApi.Marker({
          position: { lat: p.lat, lng: p.lng },
          map,
          title: p.name,
        }),
    );
    ready.value = true;
  } catch (err) {
    errorState.value = true;
    log.warn("preview map failed to load", { error: String(err) });
  }
}

onMounted(() => {
  void bootstrap();
});

onUnmounted(() => {
  for (const m of markers) m.setMap(null);
  markers = [];
});
</script>

<template>
  <div class="map-preview" data-testid="map-preview">
    <p v-if="props.selectedResult.favorite" class="text">✓ {{ t.previewSaved({ name: props.selectedResult.favorite.name }) }}</p>
    <p v-else-if="props.selectedResult.favorites" class="text">
      {{ t.favoritesCount({ count: props.selectedResult.favorites.length }) }}
    </p>

    <div v-if="pointsToRender().length > 0 && !errorState" ref="mapEl" class="preview-canvas" :class="{ ready }" data-testid="map-preview-canvas" />
  </div>
</template>

<style scoped>
.map-preview {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: #374151;
}
.text {
  margin: 0;
}
.preview-canvas {
  height: 120px;
  width: 100%;
  max-width: 320px;
  border-radius: 0.375rem;
  background: #f3f4f6;
  /* Hide the canvas until the map mounts so we don't show the empty
     grey panel for a frame. Once `ready` flips, the SDK has painted
     the map onto the same div. */
  opacity: 0;
  transition: opacity 200ms ease-out;
}
.preview-canvas.ready {
  opacity: 1;
}
</style>
