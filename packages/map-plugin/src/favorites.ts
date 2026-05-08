// Pure data + I/O helpers for the favorites list.
//
// Kept separate from `index.ts` so unit tests can exercise the Zod
// schemas + sorting / filter / dedup logic without instantiating the
// runtime. The plugin handler in `index.ts` wires these to
// `runtime.files.data` and adds a write-lock + pubsub.

import { z } from "zod";

// Latitude / longitude bounds. Kept here so the schema is the
// single source of truth — any caller (handler, View, future
// migration) gets the same validation.
const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

export const Favorite = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  lat: z.number().min(LAT_MIN).max(LAT_MAX),
  lng: z.number().min(LNG_MIN).max(LNG_MAX),
  placeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  // wikiSlug lands in PR-D — declared early so the schema doesn't
  // need to migrate when the field arrives. Optional → tolerant of
  // both shapes during the rollout.
  wikiSlug: z.string().optional(),
  addedAt: z.string(),
  updatedAt: z.string(),
});
export type Favorite = z.infer<typeof Favorite>;

export const FavoritesFile = z.object({
  version: z.literal(1),
  favorites: z.array(Favorite),
});
export type FavoritesFile = z.infer<typeof FavoritesFile>;

export const DEFAULT_FAVORITES: FavoritesFile = { version: 1, favorites: [] };

/** Newest-first sort. Used both at write time (so the list on disk is
 *  pre-sorted and reads are cheap) and at read time (defensive — a
 *  hand-edited file might be out of order). */
export function sortByAddedDesc(items: Favorite[]): Favorite[] {
  return [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/** Insert a new favorite at the head of the list. Caller has already
 *  composed the full record (uuid, timestamps, etc.) — this function
 *  just enforces the "no duplicate id" invariant. */
export function insertFavorite(items: Favorite[], next: Favorite): Favorite[] {
  if (items.some((item) => item.id === next.id)) {
    throw new Error(`favorites: duplicate id ${next.id}`);
  }
  return sortByAddedDesc([next, ...items]);
}

/** Remove by id. Returns the new array AND whether anything was
 *  actually removed, so the handler can surface a `not_found` error
 *  to the LLM instead of silently succeeding on a stale id. */
export function removeFavoriteById(items: Favorite[], id: string): { next: Favorite[]; removed: boolean } {
  const next = items.filter((item) => item.id !== id);
  return { next, removed: next.length !== items.length };
}

/** Parse and validate the on-disk shape. Falls back to the empty
 *  default when the file is corrupt — same policy as `readConfig`
 *  in index.ts: a bad file shouldn't brick `/map`, the user can
 *  re-add favorites and the file will be rewritten. The caller is
 *  expected to log the error so the failure is observable. */
export function parseFavoritesFile(raw: string): FavoritesFile {
  const parsed = FavoritesFile.parse(JSON.parse(raw));
  // Re-sort defensively — a hand-edit might have left the list out
  // of date order. Cheap at favorites-list scale.
  return { ...parsed, favorites: sortByAddedDesc(parsed.favorites) };
}

export function serializeFavoritesFile(file: FavoritesFile): string {
  return JSON.stringify({ ...file, favorites: sortByAddedDesc(file.favorites) }, null, 2);
}
