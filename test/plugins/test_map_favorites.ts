// Unit tests for the pure favorites helpers (#1227 PR-B).
//
// These cover the schema + array transforms in isolation, without
// loading the full plugin runtime — the integration test
// (test_map_integration.ts) already exercises the handler end-to-end.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Favorite,
  FavoritesFile,
  insertFavorite,
  parseFavoritesFile,
  removeFavoriteById,
  serializeFavoritesFile,
  sortByAddedDesc,
} from "../../packages/map-plugin/src/favorites";

const TIME_0 = "2026-05-01TIME_00:00:00.000Z";
const TIME_1 = "2026-05-02TIME_00:00:00.000Z";
const TIME_2 = "2026-05-03TIME_00:00:00.000Z";

function makeFav(overrides: Partial<Favorite> = {}): Favorite {
  return Favorite.parse({
    id: overrides.id ?? "fav-1",
    name: overrides.name ?? "Sushi Yumeji",
    lat: overrides.lat ?? 35.6762,
    lng: overrides.lng ?? 139.6503,
    addedAt: overrides.addedAt ?? TIME_0,
    updatedAt: overrides.updatedAt ?? TIME_0,
    ...overrides,
  });
}

describe("Favorite schema validation", () => {
  it("accepts a minimal favorite", () => {
    const fav = makeFav();
    assert.equal(fav.name, "Sushi Yumeji");
    assert.equal(fav.tags, undefined);
  });

  it("rejects out-of-range latitude", () => {
    assert.throws(() => Favorite.parse({ id: "x", name: "x", lat: 95, lng: 0, addedAt: TIME_0, updatedAt: TIME_0 }));
  });

  it("rejects out-of-range longitude", () => {
    assert.throws(() => Favorite.parse({ id: "x", name: "x", lat: 0, lng: -190, addedAt: TIME_0, updatedAt: TIME_0 }));
  });

  it("rejects empty name", () => {
    assert.throws(() => Favorite.parse({ id: "x", name: "", lat: 0, lng: 0, addedAt: TIME_0, updatedAt: TIME_0 }));
  });

  it("preserves optional fields", () => {
    const fav = makeFav({ tags: ["food", "tokyo"], notes: "great omakase", placeId: "ChIJxxx" });
    assert.deepEqual(fav.tags, ["food", "tokyo"]);
    assert.equal(fav.notes, "great omakase");
    assert.equal(fav.placeId, "ChIJxxx");
  });
});

describe("sortByAddedDesc", () => {
  it("returns newest first", () => {
    const items = [makeFav({ id: "a", addedAt: TIME_0 }), makeFav({ id: "b", addedAt: TIME_2 }), makeFav({ id: "c", addedAt: TIME_1 })];
    const sorted = sortByAddedDesc(items);
    assert.deepEqual(
      sorted.map((fav) => fav.id),
      ["b", "c", "a"],
    );
  });

  it("does not mutate the input array", () => {
    const items = [makeFav({ id: "a", addedAt: TIME_0 }), makeFav({ id: "b", addedAt: TIME_1 })];
    sortByAddedDesc(items);
    assert.equal(items[0].id, "a");
    assert.equal(items[1].id, "b");
  });

  it("returns an empty array unchanged", () => {
    assert.deepEqual(sortByAddedDesc([]), []);
  });
});

describe("insertFavorite", () => {
  it("adds a new entry and re-sorts by addedAt desc", () => {
    const items = [makeFav({ id: "old", addedAt: TIME_0 })];
    const next = insertFavorite(items, makeFav({ id: "new", addedAt: TIME_1 }));
    assert.equal(next.length, 2);
    assert.equal(next[0].id, "new");
    assert.equal(next[1].id, "old");
  });

  it("rejects a duplicate id", () => {
    const items = [makeFav({ id: "dup" })];
    assert.throws(() => insertFavorite(items, makeFav({ id: "dup", name: "different name", addedAt: TIME_1 })), /duplicate id/);
  });
});

describe("removeFavoriteById", () => {
  it("removes the matching id and reports removed=true", () => {
    const items = [makeFav({ id: "a" }), makeFav({ id: "b" })];
    const result = removeFavoriteById(items, "a");
    assert.equal(result.removed, true);
    assert.deepEqual(
      result.next.map((fav) => fav.id),
      ["b"],
    );
  });

  it("reports removed=false when the id is unknown", () => {
    const items = [makeFav({ id: "a" })];
    const result = removeFavoriteById(items, "ghost");
    assert.equal(result.removed, false);
    assert.deepEqual(
      result.next.map((fav) => fav.id),
      ["a"],
    );
  });

  it("returns an empty array unchanged", () => {
    const result = removeFavoriteById([], "anything");
    assert.equal(result.removed, false);
    assert.deepEqual(result.next, []);
  });
});

describe("parseFavoritesFile / serializeFavoritesFile", () => {
  it("round-trips a typed file", () => {
    const file: FavoritesFile = { version: 1, favorites: [makeFav({ id: "a", addedAt: TIME_0 }), makeFav({ id: "b", addedAt: TIME_1 })] };
    const parsed = parseFavoritesFile(serializeFavoritesFile(file));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.favorites.length, 2);
    // Sort applied — newer first.
    assert.equal(parsed.favorites[0].id, "b");
  });

  it("re-sorts a hand-edited out-of-order file", () => {
    const raw = JSON.stringify({
      version: 1,
      favorites: [
        { id: "old", name: "old", lat: 0, lng: 0, addedAt: TIME_0, updatedAt: TIME_0 },
        { id: "new", name: "new", lat: 1, lng: 1, addedAt: TIME_2, updatedAt: TIME_2 },
      ],
    });
    const parsed = parseFavoritesFile(raw);
    assert.equal(parsed.favorites[0].id, "new");
  });

  it("rejects a wrong version", () => {
    assert.throws(() => parseFavoritesFile(JSON.stringify({ version: 2, favorites: [] })));
  });

  it("rejects malformed favorites entries", () => {
    assert.throws(() => parseFavoritesFile(JSON.stringify({ version: 1, favorites: [{ id: "x" }] })));
  });
});
