// Module-scoped loader for the Google Maps JS SDK.
//
// The SDK script is ~600 KB gzipped and each `new google.maps.Map`
// instance is a billable load. We cache the load Promise so a second
// call (any other map widget mounting in the same SPA session) reuses
// the already-loaded `google` global without re-injecting the script
// or hitting Google a second time.
//
// `loadMapsSdk(apiKey)` is the only export. Callers do:
//
//   const google = await loadMapsSdk(apiKey);
//   new google.maps.Map(el, { ... });

// Tell TS that `window.google` is the Google Maps namespace once the
// script loads. The actual shape lives in `@types/google.maps`, but
// the plugin's `peerDependencies` keep the dependency surface small,
// so we declare a thin escape hatch here. Plugin authors who need
// fuller types can add `@types/google.maps` as a devDep locally.
declare global {
  interface Window {
    google?: { maps?: unknown };
  }
}

const SCRIPT_URL_BASE = "https://maps.googleapis.com/maps/api/js";
// `places` is included so PR-C's autocomplete works without a second
// SDK load. Loading the library here is essentially free if PR-C
// hasn't shipped yet — it just adds a few KB to the SDK bundle.
const LIBRARIES = "places";

let pending: Promise<unknown> | null = null;
let loadedWithKey: string | null = null;

/** Resolve to the `google.maps` namespace once the SDK is ready.
 *  Subsequent calls in the same SPA session reuse the cached Promise.
 *  If a different `apiKey` is requested mid-session, the second call
 *  rejects rather than silently using the first key — switching keys
 *  requires a full reload (the SDK doesn't support multi-key in one
 *  page). */
export function loadMapsSdk(apiKey: string): Promise<unknown> {
  if (apiKey.length === 0) {
    return Promise.reject(new Error("loadMapsSdk: apiKey is empty"));
  }
  if (pending && loadedWithKey !== null && loadedWithKey !== apiKey) {
    return Promise.reject(new Error("loadMapsSdk: a different API key was already loaded; reload the page to switch keys"));
  }
  if (pending) return pending;

  loadedWithKey = apiKey;
  pending = new Promise((resolve, reject) => {
    const params = new URLSearchParams({ key: apiKey, libraries: LIBRARIES, loading: "async", v: "weekly" });
    const script = document.createElement("script");
    script.src = `${SCRIPT_URL_BASE}?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const google = window.google;
      if (!google?.maps) {
        reject(new Error("Maps SDK loaded but window.google.maps is missing"));
        return;
      }
      resolve(google.maps);
    };
    script.onerror = () => {
      // Reset so a retry (e.g. user re-saves the key after fixing the
      // referer restriction) can re-attempt. Without this the cached
      // rejected Promise blocks every subsequent attempt.
      pending = null;
      loadedWithKey = null;
      reject(new Error("Failed to load Google Maps SDK — check API key and referrer restrictions"));
    };
    document.head.appendChild(script);
  });
  return pending;
}

/** Test seam — drop the cached promise so the next `loadMapsSdk`
 *  call starts fresh. Production code never calls this. */
export function _resetMapsSdkLoader(): void {
  pending = null;
  loadedWithKey = null;
}
