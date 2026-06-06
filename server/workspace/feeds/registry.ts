// List the registered data-source feeds. Feeds are CREATED / REMOVED by
// the agent writing / deleting `feeds/<slug>/schema.json` directly (see
// config/helps/feeds.md) — the host only discovers + retrieves them.
// icon / dataPath defaults for agent-authored feed schemas are applied in
// `collections/discovery.ts` (source === "feed").

import { rm } from "node:fs/promises";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { discoverCollections, loadCollection, type LoadedCollection } from "../collections/index.js";
import { isContainedInRoot, safeSlugName } from "../collections/paths.js";
import { feedDir } from "./paths.js";

/** Every registered feed, as a discovered collection (carrying its
 *  validated schema, `ingest`, and resolved `dataDir`). */
export async function listFeeds(workspaceRoot: string = workspacePath): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ workspaceRoot });
  return all.filter((collection) => collection.source === "feed");
}

/** Delete a feed entirely: its fetched records (the schema's resolved
 *  `dataDir`) AND its `feeds/<slug>/` directory (schema + state).
 *  Idempotent. Host-side only (backs the UI delete button); the agent
 *  removes a feed by deleting both directories with its own file tools.
 *  The records dir is only removed when the slug resolves to an actual
 *  feed and stays within the workspace (never touches a skill collection's
 *  data on a slug collision). */
export async function removeFeed(workspaceRoot: string, slug: string): Promise<boolean> {
  const safe = safeSlugName(slug);
  if (safe === null) return false;
  const feed = await loadCollection(safe, { workspaceRoot });
  try {
    if (feed?.source === "feed" && isContainedInRoot(feed.dataDir, workspaceRoot)) {
      await rm(feed.dataDir, { recursive: true, force: true });
    }
    await rm(feedDir(safe, workspaceRoot), { recursive: true, force: true });
    log.info("feeds", "feed + records removed", { slug: safe });
    return true;
  } catch (error) {
    log.warn("feeds", "feed remove failed", { slug: safe, error: String(error) });
    return false;
  }
}
