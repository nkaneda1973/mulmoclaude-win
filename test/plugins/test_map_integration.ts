// End-to-end integration test for the Map runtime plugin
// (#1227 PR-A + PR-B).
//
// PR-A: API-key configure round-trip (status / configure / status).
// PR-B: favorites CRUD + getApiKey for the View's SDK bootstrap.
// Loads the workspace-built `dist/index.js` through the real runtime
// loader with a real `makePluginRuntime` against an isolated tmp
// workspace.
//
// Mirrors the shape of test_recipe_book_integration.ts. Skips
// automatically when the plugin's dist isn't present (CI runs
// `yarn build:packages` before tests so this is hard-required there).

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime, sanitisePackageNameForFs } from "../../server/plugins/runtime.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/map-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/map-plugin";
const VERSION = "0.1.0";

interface DispatchResult {
  ok: boolean;
  configured?: boolean;
  error?: string;
  apiKey?: string;
  favorite?: { id: string; name: string; lat: number; lng: number; tags?: string[] };
  favorites?: { id: string; name: string; lat: number; lng: number; tags?: string[] }[];
}

function makeRecordingPubSub(): { pubsub: IPubSub; published: { channel: string; data: unknown }[] } {
  const published: { channel: string; data: unknown }[] = [];
  return {
    pubsub: {
      publish(channel, data) {
        published.push({ channel, data });
      },
    },
    published,
  };
}

describe("Map plugin — end-to-end through the loader (PR-A)", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[map integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/map-plugin/`);
    }
  });

  // Capture the FULL property descriptor so afterEach restores
  // writability + enumerability flags too — same fix as
  // test_bookmarks_integration.ts (Codex review iter on PR #1124).
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let savedDataDescriptor: PropertyDescriptor | undefined;
  let configRoot: string;
  let dataRoot: string;

  beforeEach(() => {
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    configRoot = mkdtempSync(path.join(tmpdir(), "map-int-config-"));
    dataRoot = mkdtempSync(path.join(tmpdir(), "map-int-data-"));
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
  });

  afterEach(() => {
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    rmSync(configRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it("status → configure → status round-trip + configure publishes a 'configured-changed' event", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageMap");
    assert.ok(plugin.execute, "execute handler must be present");

    // 1. Fresh workspace → not configured
    let res = (await plugin.execute({}, { kind: "status" })) as DispatchResult;
    assert.deepEqual(res, { ok: true, configured: false });
    assert.equal(published.length, 0, "status must not publish");

    // 2. configure → ok:true, key persisted, "configured-changed" emitted
    res = (await plugin.execute({}, { kind: "configure", apiKey: "AIzaTestKey1234567890" })) as DispatchResult;
    assert.equal(res.ok, true);
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:configured-changed`);
    assert.deepEqual(published[0].data, { configured: true });

    // 3. status now reports configured
    res = (await plugin.execute({}, { kind: "status" })) as DispatchResult;
    assert.deepEqual(res, { ok: true, configured: true });

    // 4. Persisted file lives under pluginsConfig/<sanitisedPkg>/google-maps.json
    // (`@mulmoclaude/map-plugin` → `%40mulmoclaude%2Fmap-plugin`)
    const configFile = path.join(configRoot, sanitisePackageNameForFs(PKG_NAME), "google-maps.json");
    assert.ok(existsSync(configFile), `expected config file at ${configFile}`);
    const stored = JSON.parse(readFileSync(configFile, "utf-8")) as { version: number; googleMapsApiKey?: string };
    assert.equal(stored.version, 1);
    assert.equal(stored.googleMapsApiKey, "AIzaTestKey1234567890");
  });

  it("rejects an empty apiKey with a Zod parse error", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    const execute = plugin?.execute;
    assert.ok(execute);
    if (!execute) return;

    await assert.rejects(async () => {
      await execute({}, { kind: "configure", apiKey: "" });
    }, /min|too_small|String/i);
  });

  it("getApiKey returns the stored key after configure, not_configured before", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    const execute = plugin?.execute;
    assert.ok(execute);
    if (!execute) return;

    // Empty workspace → not_configured.
    let res = (await execute({}, { kind: "getApiKey" })) as DispatchResult;
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_configured");

    // Configure → key flows back through getApiKey.
    await execute({}, { kind: "configure", apiKey: "FAKE_KEY_FOR_TESTING_ONLY" });
    res = (await execute({}, { kind: "getApiKey" })) as DispatchResult;
    assert.equal(res.ok, true);
    assert.equal(res.apiKey, "FAKE_KEY_FOR_TESTING_ONLY");
  });

  it("favorites round-trip: empty → addFavorite → list → remove → list", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    const execute = plugin?.execute;
    assert.ok(execute);
    if (!execute) return;

    // 1. Fresh workspace → []
    let res = (await execute({}, { kind: "listFavorites" })) as DispatchResult;
    assert.deepEqual(res, { ok: true, favorites: [] });
    assert.equal(published.length, 0, "list must not publish");

    // 2. addFavorite with tags + notes → ok:true + 'favorites-changed' pub event
    res = (await execute(
      {},
      {
        kind: "addFavorite",
        name: "Sushi Yumeji",
        lat: 35.6762,
        lng: 139.6503,
        tags: ["food", "tokyo"],
        notes: "great omakase",
      },
    )) as DispatchResult;
    assert.equal(res.ok, true);
    assert.ok(res.favorite);
    assert.equal(res.favorite?.name, "Sushi Yumeji");
    assert.deepEqual(res.favorite?.tags, ["food", "tokyo"]);
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:favorites-changed`);

    // 3. list returns the favorite
    res = (await execute({}, { kind: "listFavorites" })) as DispatchResult;
    assert.equal(res.favorites?.length, 1);
    assert.equal(res.favorites?.[0].name, "Sushi Yumeji");

    // 4. addFavorite (second one, no tags) → newest-first sort
    await execute({}, { kind: "addFavorite", name: "Coffee Bar", lat: 35.66, lng: 139.71 });
    res = (await execute({}, { kind: "listFavorites" })) as DispatchResult;
    assert.equal(res.favorites?.length, 2);
    // Newest first
    assert.equal(res.favorites?.[0].name, "Coffee Bar");
    assert.equal(res.favorites?.[1].name, "Sushi Yumeji");

    // 5. removeFavorite by id
    const sushi = res.favorites?.[1];
    assert.ok(sushi);
    if (!sushi) return;
    const removeRes = (await execute({}, { kind: "removeFavorite", id: sushi.id })) as DispatchResult;
    assert.equal(removeRes.ok, true);

    // 6. list reflects the removal
    res = (await execute({}, { kind: "listFavorites" })) as DispatchResult;
    assert.equal(res.favorites?.length, 1);
    assert.equal(res.favorites?.[0].name, "Coffee Bar");

    // 7. removeFavorite with unknown id → not_found
    const ghostRes = (await execute({}, { kind: "removeFavorite", id: "ghost-id" })) as DispatchResult;
    assert.equal(ghostRes.ok, false);
    assert.equal(ghostRes.error, "not_found");

    // 8. Persisted file lives under pluginsData/<sanitisedPkg>/favorites.json
    const dataFile = path.join(dataRoot, sanitisePackageNameForFs(PKG_NAME), "favorites.json");
    assert.ok(existsSync(dataFile), `expected favorites file at ${dataFile}`);
    const stored = JSON.parse(readFileSync(dataFile, "utf-8")) as { version: number; favorites: { name: string }[] };
    assert.equal(stored.version, 1);
    assert.equal(stored.favorites.length, 1);
    assert.equal(stored.favorites[0].name, "Coffee Bar");
  });

  it("addFavorite rejects out-of-range lat/lng", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    const execute = plugin?.execute;
    assert.ok(execute);
    if (!execute) return;

    await assert.rejects(async () => {
      await execute({}, { kind: "addFavorite", name: "Bad Pin", lat: 95, lng: 0 });
    });
    await assert.rejects(async () => {
      await execute({}, { kind: "addFavorite", name: "Bad Pin", lat: 0, lng: -200 });
    });
  });
});
