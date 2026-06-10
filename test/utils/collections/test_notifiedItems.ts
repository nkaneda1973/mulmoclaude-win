// Unit tests for collectionNotifiedItemIds
// (src/utils/collections/notifiedItems.ts) — maps active bell entries to
// the (slug, itemId) records they deep-link, so the Kanban board can flag
// cards that have a pending notification.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionNotifiedItemIds, type NotifiedEntryLike } from "../../../src/utils/collections/notifiedItems.js";

/** A bell entry shaped like the ones `notifications.ts` publishes:
 *  `pluginData.action.target = { view: "collections", slug, itemId }`. */
function collectionEntry(slug: string, itemId?: string): NotifiedEntryLike {
  return { pluginData: { action: { type: "navigate", target: { view: "collections", slug, itemId } } } };
}

describe("collectionNotifiedItemIds", () => {
  it("collects item ids for the matching slug", () => {
    const entries = [collectionEntry("tasks", "t1"), collectionEntry("tasks", "t2"), collectionEntry("notes", "n1")];
    assert.deepEqual(collectionNotifiedItemIds(entries, "tasks"), new Set(["t1", "t2"]));
  });

  it("ignores entries for other collections", () => {
    assert.deepEqual(collectionNotifiedItemIds([collectionEntry("notes", "n1")], "tasks"), new Set());
  });

  it("skips collection-level entries that carry no itemId", () => {
    assert.deepEqual(collectionNotifiedItemIds([collectionEntry("tasks")], "tasks"), new Set());
  });

  it("ignores entries whose target is a different view", () => {
    const wiki: NotifiedEntryLike = { pluginData: { action: { target: { view: "wiki", slug: "tasks", itemId: "t1" } } } };
    assert.deepEqual(collectionNotifiedItemIds([wiki], "tasks"), new Set());
  });

  it("tolerates entries with absent or malformed pluginData", () => {
    const entries: NotifiedEntryLike[] = [
      {},
      { pluginData: null },
      { pluginData: "nope" },
      { pluginData: { action: {} } },
      { pluginData: { action: { target: { view: "collections" } } } }, // missing slug
      collectionEntry("tasks", "t1"),
    ];
    assert.deepEqual(collectionNotifiedItemIds(entries, "tasks"), new Set(["t1"]));
  });
});
