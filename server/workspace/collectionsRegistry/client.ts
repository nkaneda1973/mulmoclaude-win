// Server-side client for the curated collection registry's published index.json
// (receptron/mulmoclaude-collections via GitHub Pages). Fetches over HTTPS with
// a timeout, validates against the index contract, and memo-caches the last good
// result so the Discover tab doesn't hammer the upstream. On a transient upstream
// failure it serves the last good index rather than erroring.

import { fetchWithTimeout } from "../../utils/fetch.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { parseRegistryIndex, type RegistryIndex } from "./registryIndex.js";

const DEFAULT_REGISTRY_URL = "https://receptron.github.io/mulmoclaude-collections/index.json";
const CACHE_TTL_MS = 5 * 60 * ONE_SECOND_MS;
const FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;

export type FetchIndexResult = { ok: true; index: RegistryIndex; stale: boolean } | { ok: false; status: number; error: string };

interface CacheEntry {
  index: RegistryIndex;
  atMs: number;
}

let cache: CacheEntry | null = null;

export function registryIndexUrl(): string {
  return process.env.COLLECTIONS_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
}

async function loadFromNetwork(): Promise<FetchIndexResult> {
  const url = registryIndexUrl();
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: "application/json" } });
  } catch (err) {
    log.warn("collections-registry", "index fetch failed", { url, error: errorMessage(err) });
    return { ok: false, status: STATUS_UNAVAILABLE, error: "registry unreachable" };
  }
  if (!res.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry responded ${res.status}` };
  const json: unknown = await res.json().catch(() => null);
  const parsed = parseRegistryIndex(json);
  if (!parsed.ok) {
    log.warn("collections-registry", "index invalid", { url, error: parsed.error });
    return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry index invalid: ${parsed.error}` };
  }
  return { ok: true, index: parsed.index, stale: false };
}

/** Fetch the registry index, served from cache within the TTL. On upstream
 *  failure, falls back to the last good index (marked `stale`) when available. */
export async function fetchRegistryIndex(opts: { force?: boolean; nowMs?: number } = {}): Promise<FetchIndexResult> {
  const nowMs = opts.nowMs ?? Date.now();
  if (!opts.force && cache && nowMs - cache.atMs < CACHE_TTL_MS) {
    return { ok: true, index: cache.index, stale: false };
  }
  const fresh = await loadFromNetwork();
  if (fresh.ok) {
    cache = { index: fresh.index, atMs: nowMs };
    return fresh;
  }
  if (cache) return { ok: true, index: cache.index, stale: true };
  return fresh;
}

/** Test seam: reset the module cache. */
export function resetRegistryCache(): void {
  cache = null;
}
