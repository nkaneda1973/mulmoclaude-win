// Map active bell notifications back to the collection records they
// point at, so views (the Kanban board) can flag a card that has a
// pending notification.
//
// Collection-completion entries are published by
// `server/workspace/collections/notifications.ts` with a typed
// `pluginData.action.target = { view: "collections", slug, itemId }`
// (see `LegacyNotifierPluginData`). `pluginData` arrives on the client
// as `unknown`, so we narrow defensively rather than trusting its shape.

import { NOTIFICATION_VIEWS } from "../../types/notification";

/** The minimum entry shape this module reads — a structural subset of
 *  `NotifierEntry` so callers can pass entries straight from
 *  `useNotifications()` without a cast. */
export interface NotifiedEntryLike {
  pluginData?: unknown;
}

interface CollectionTarget {
  slug: string;
  itemId?: string;
}

/** Narrow an entry's opaque `pluginData` to its collection navigate
 *  target, or null when it isn't a collection-targeting entry. */
function collectionTargetOf(pluginData: unknown): CollectionTarget | null {
  if (!pluginData || typeof pluginData !== "object") return null;
  const { action } = pluginData as { action?: unknown };
  if (!action || typeof action !== "object") return null;
  const { target } = action as { target?: unknown };
  if (!target || typeof target !== "object") return null;
  const { view, slug, itemId } = target as { view?: unknown; slug?: unknown; itemId?: unknown };
  if (view !== NOTIFICATION_VIEWS.collections || typeof slug !== "string") return null;
  return { slug, itemId: typeof itemId === "string" ? itemId : undefined };
}

/** Item ids in `slug` that currently have an active bell notification.
 *  Only entries carrying a concrete `itemId` are included (a bare
 *  collection-level target can't highlight a specific card). */
export function collectionNotifiedItemIds(entries: readonly NotifiedEntryLike[], slug: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const target = collectionTargetOf(entry.pluginData);
    if (target && target.slug === slug && target.itemId) ids.add(target.itemId);
  }
  return ids;
}
