// End-to-end integration test for the Reading List runtime plugin
// (#1188 / #1169 PR-A My Library). Loads the workspace-built
// `dist/index.js` through the real runtime loader with a real
// `makePluginRuntime`, then exercises save → read → update → delete
// + the metadata-preservation invariant against an isolated tmp
// workspace.
//
// Skips automatically when the plugin's dist isn't present (i.e.
// `yarn build` hasn't been run in `packages/reading-list-plugin/`).
// CI runs `yarn build:packages` before tests so this is hard-required
// in CI.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/reading-list-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/reading-list-plugin";
const VERSION = "0.1.0";

type ReadingStatus = "want" | "reading" | "read" | "abandoned";

interface BookSummary {
  slug: string;
  title: string;
  author: string;
  status: ReadingStatus;
  rating: number | null;
  tags: string[];
  updated: string;
}

interface Book extends BookSummary {
  isbn: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  created: string;
  body: string;
}

interface BookResult {
  ok: boolean;
  book?: Book;
  books?: BookSummary[];
  slug?: string;
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

describe("Reading List plugin — end-to-end through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[reading-list integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/reading-list-plugin/`);
    }
  });

  // Capture the FULL property descriptor so afterEach restores
  // writability + enumerability flags too — same pattern as
  // test_recipe_book_integration.ts.
  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "reading-list-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "reading-list-int-config-"));
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("save → read → list → delete round-trip with frontmatter preserved", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageReadingList");
    assert.ok(plugin.execute, "execute handler must be present");

    // 1. List on empty workspace → []
    let res = (await plugin.execute({}, { kind: "list" })) as BookResult;
    assert.deepEqual(res, { ok: true, books: [] });
    assert.equal(published.length, 0, "list must not publish");

    // 2. Save → ok:true + "changed" pub event. Use a non-ASCII title
    // to lock in the romanised-slug convention from the role prompt.
    res = (await plugin.execute(
      {},
      {
        kind: "save",
        slug: "thinking-fast-and-slow",
        title: "Thinking, Fast and Slow",
        author: "Daniel Kahneman",
        isbn: "9780374533557",
        status: "read",
        rating: 5,
        startedAt: "2025-01-15",
        finishedAt: "2025-03-20",
        tags: ["psychology", "behavioral-economics"],
        body: "## Notes\n- Two systems: fast intuition vs slow reasoning\n\n## Quotes\n- *Nothing in life is as important as you think it is, while you are thinking about it.*\n",
      },
    )) as BookResult;
    assert.equal(res.ok, true);
    assert.equal(res.book?.slug, "thinking-fast-and-slow");
    assert.equal(res.book?.status, "read");
    assert.equal(res.book?.rating, 5);
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:changed`);

    // 3. Read returns the full book with all frontmatter + body
    res = (await plugin.execute({}, { kind: "read", slug: "thinking-fast-and-slow" })) as BookResult;
    assert.equal(res.ok, true);
    assert.ok(res.book);
    if (!res.book) return;
    assert.equal(res.book.title, "Thinking, Fast and Slow");
    assert.equal(res.book.author, "Daniel Kahneman");
    assert.equal(res.book.isbn, "9780374533557");
    assert.equal(res.book.status, "read");
    assert.equal(res.book.rating, 5);
    assert.equal(res.book.startedAt, "2025-01-15");
    assert.equal(res.book.finishedAt, "2025-03-20");
    assert.deepEqual(res.book.tags, ["psychology", "behavioral-economics"]);
    assert.match(res.book.body, /## Notes/);
    assert.match(res.book.body, /## Quotes/);
    assert.equal(typeof res.book.created, "string");
    assert.equal(typeof res.book.updated, "string");

    // 4. List returns one summary (body / dates / isbn stripped).
    res = (await plugin.execute({}, { kind: "list" })) as BookResult;
    assert.equal(res.books?.length, 1);
    assert.equal(res.books?.[0].slug, "thinking-fast-and-slow");
    assert.equal(res.books?.[0].status, "read");
    assert.equal(res.books?.[0].rating, 5);

    // 5. Read on missing slug → not_found
    res = (await plugin.execute({}, { kind: "read", slug: "ghost" })) as BookResult;
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_found");

    // 6. Delete → ok + second pub event
    res = (await plugin.execute({}, { kind: "delete", slug: "thinking-fast-and-slow" })) as BookResult;
    assert.equal(res.ok, true);
    assert.equal(published.length, 2);

    // 7. Read after delete → not_found
    res = (await plugin.execute({}, { kind: "read", slug: "thinking-fast-and-slow" })) as BookResult;
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_found");
  });

  it("save defaults status to `want` when omitted", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    if (!plugin?.execute) return;

    const saveRes = (await plugin.execute(
      {},
      {
        kind: "save",
        slug: "sapiens",
        title: "Sapiens",
        author: "Yuval Noah Harari",
      },
    )) as BookResult;
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.book?.status, "want");

    const readRes = (await plugin.execute({}, { kind: "read", slug: "sapiens" })) as BookResult;
    assert.equal(readRes.book?.status, "want");
    assert.equal(readRes.book?.body.trim(), "");
  });

  // Same metadata-preservation invariant as recipe-book — a notes-only
  // update must keep the rating, dates, status, etc. that the user set
  // earlier. Locks in the contract before someone ports a stale "wipe
  // when omitted" pattern across plugins.
  it("update preserves omitted optional metadata (status / rating / dates / tags / isbn)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    const { execute } = plugin;
    assert.ok(execute);

    await execute(
      {},
      {
        kind: "save",
        slug: "atomic-habits",
        title: "Atomic Habits",
        author: "James Clear",
        isbn: "9780735211292",
        status: "read",
        rating: 4,
        startedAt: "2024-11-01",
        finishedAt: "2024-12-15",
        tags: ["self-help", "productivity"],
        body: "Original notes",
      },
    );

    // Update only body — omit every optional metadata field.
    const updateRes = (await execute(
      {},
      {
        kind: "update",
        slug: "atomic-habits",
        title: "Atomic Habits",
        author: "James Clear",
        body: "Refined notes — habit stacking is the key takeaway",
      },
    )) as BookResult;
    assert.equal(updateRes.ok, true);

    const readRes = (await execute({}, { kind: "read", slug: "atomic-habits" })) as BookResult;
    assert.equal(readRes.ok, true);
    assert.ok(readRes.book);
    if (!readRes.book) return;
    assert.match(readRes.book.body, /habit stacking/);
    assert.equal(readRes.book.isbn, "9780735211292", "isbn must survive a body-only update");
    assert.equal(readRes.book.status, "read", "status must survive");
    assert.equal(readRes.book.rating, 4, "rating must survive");
    assert.equal(readRes.book.startedAt, "2024-11-01", "startedAt must survive");
    assert.equal(readRes.book.finishedAt, "2024-12-15", "finishedAt must survive");
    assert.deepEqual(readRes.book.tags, ["self-help", "productivity"], "tags must survive");
  });

  it("status transitions (want → reading → read) preserve `created` and advance `updated`", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    const { execute } = plugin;
    assert.ok(execute);

    await execute({}, { kind: "save", slug: "deep-work", title: "Deep Work", author: "Cal Newport" });
    const initial = (await execute({}, { kind: "read", slug: "deep-work" })) as BookResult;
    assert.ok(initial.book);
    if (!initial.book) return;
    const createdAt = initial.book.created;
    assert.equal(initial.book.status, "want");

    // Wait long enough for the timestamp to advance — node's Date
    // resolution is ms, but a tight loop can produce identical
    // timestamps. 5ms is plenty.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    await execute({}, { kind: "update", slug: "deep-work", title: "Deep Work", author: "Cal Newport", status: "reading", startedAt: "2026-01-01" });
    const reading = (await execute({}, { kind: "read", slug: "deep-work" })) as BookResult;
    assert.equal(reading.book?.status, "reading");
    assert.equal(reading.book?.startedAt, "2026-01-01");
    assert.equal(reading.book?.created, createdAt, "created must not change on update");
    assert.notEqual(reading.book?.updated, createdAt, "updated must advance on update");
  });

  it("save refuses to overwrite an existing slug", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    if (!plugin?.execute) return;

    await plugin.execute({}, { kind: "save", slug: "dup", title: "First", author: "Alice" });
    const second = (await plugin.execute({}, { kind: "save", slug: "dup", title: "Second", author: "Bob" })) as BookResult;
    assert.equal(second.ok, false);
    assert.equal(second.error, "exists");
  });

  it("rejects invalid slugs at read / delete (Zod rejects them at save / update)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    if (!plugin?.execute) return;
    const { execute } = plugin;

    const badRead = (await execute({}, { kind: "read", slug: "Bad Slug!" })) as BookResult;
    assert.equal(badRead.ok, false);
    assert.equal(badRead.error, "invalid_slug");

    const badDelete = (await execute({}, { kind: "delete", slug: "Bad Slug!" })) as BookResult;
    assert.equal(badDelete.ok, false);
    assert.equal(badDelete.error, "invalid_slug");
  });

  it("save rejects missing title or author", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    if (!plugin?.execute) return;
    const { execute } = plugin;

    const blankTitle = (await execute({}, { kind: "save", slug: "no-title", title: "   ", author: "Alice" })) as BookResult;
    assert.equal(blankTitle.ok, false);
    assert.equal(blankTitle.error, "missing_title");

    const blankAuthor = (await execute({}, { kind: "save", slug: "no-author", title: "Some book", author: "  " })) as BookResult;
    assert.equal(blankAuthor.ok, false);
    assert.equal(blankAuthor.error, "missing_author");
  });
});
