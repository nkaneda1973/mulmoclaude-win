// End-to-end integration test for the Map runtime plugin (#1227 PR-A).
//
// PR-A only ships the API-key configure round-trip. Loads the
// workspace-built `dist/index.js` through the real runtime loader
// with a real `makePluginRuntime`, then exercises status / configure
// / status against an isolated tmp workspace.
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
  let configRoot: string;

  beforeEach(() => {
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    configRoot = mkdtempSync(path.join(tmpdir(), "map-int-config-"));
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(configRoot, { recursive: true, force: true });
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
});
