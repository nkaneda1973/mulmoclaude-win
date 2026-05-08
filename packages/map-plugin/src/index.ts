// Plugin server entry — runs inside the host's Node process.
//
// PR-A scope (#1227): API-key configure round-trip.
// PR-B scope: favorites CRUD (add / list / remove) + getApiKey
//             so the View can bootstrap the Maps JS SDK without a
//             second round-trip to a separate endpoint.
//
// Persistence:
//   - config/google-maps.json   per-machine API key
//   - data/favorites.json       favorites list (workspace-shared)

import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";
import { DEFAULT_FAVORITES, type FavoritesFile, Favorite, insertFavorite, parseFavoritesFile, removeFavoriteById, serializeFavoritesFile } from "./favorites";

export { TOOL_DEFINITION };

const ConfigFile = z.object({
  version: z.literal(1),
  googleMapsApiKey: z.string().optional(),
});
type ConfigFile = z.infer<typeof ConfigFile>;

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("configure"), apiKey: z.string().min(1) }),
  z.object({ kind: z.literal("getApiKey") }),
  z.object({
    kind: z.literal("addFavorite"),
    name: z.string().min(1),
    lat: z.number().min(LAT_MIN).max(LAT_MAX),
    lng: z.number().min(LNG_MIN).max(LNG_MAX),
    placeId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
  z.object({ kind: z.literal("listFavorites") }),
  z.object({ kind: z.literal("removeFavorite"), id: z.string().min(1) }),
]);

const CONFIG_FILE = "google-maps.json";
const FAVORITES_FILE = "favorites.json";
const DEFAULT_CONFIG: ConfigFile = { version: 1 };

export default definePlugin(({ pubsub, files, log }) => {
  // Serialise read-modify-write so two parallel mutations don't both
  // load the same snapshot and silently drop one.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeLock.catch(() => undefined).then(fn);
    writeLock = next.catch(() => undefined);
    return next;
  }

  async function readConfig(): Promise<ConfigFile> {
    if (!(await files.config.exists(CONFIG_FILE))) return DEFAULT_CONFIG;
    const raw = await files.config.read(CONFIG_FILE);
    try {
      return ConfigFile.parse(JSON.parse(raw));
    } catch (err) {
      log.warn("config read failed, falling back to defaults", { error: String(err) });
      return DEFAULT_CONFIG;
    }
  }

  async function writeConfig(cfg: ConfigFile): Promise<void> {
    await files.config.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    pubsub.publish("configured-changed", { configured: Boolean(cfg.googleMapsApiKey) });
  }

  async function readFavorites(): Promise<FavoritesFile> {
    if (!(await files.data.exists(FAVORITES_FILE))) return DEFAULT_FAVORITES;
    const raw = await files.data.read(FAVORITES_FILE);
    try {
      return parseFavoritesFile(raw);
    } catch (err) {
      // Same fallback policy as readConfig — a corrupt file should
      // not brick `/map`. The user can re-add favorites; the next
      // write reformats the file.
      log.warn("favorites read failed, falling back to empty list", { error: String(err) });
      return DEFAULT_FAVORITES;
    }
  }

  async function writeFavorites(file: FavoritesFile): Promise<void> {
    await files.data.write(FAVORITES_FILE, serializeFavoritesFile(file));
    pubsub.publish("favorites-changed", { count: file.favorites.length });
  }

  return {
    TOOL_DEFINITION,

    async manageMap(rawArgs: unknown) {
      const args = Args.parse(rawArgs);
      switch (args.kind) {
        case "status": {
          const cfg = await readConfig();
          return { ok: true, configured: Boolean(cfg.googleMapsApiKey) };
        }
        case "configure": {
          return withWriteLock(async () => {
            const next: ConfigFile = { ...DEFAULT_CONFIG, googleMapsApiKey: args.apiKey };
            await writeConfig(next);
            log.info("google maps api key configured");
            return { ok: true };
          });
        }
        case "getApiKey": {
          // Returns the actual key for the in-process Vue View to
          // bootstrap the Maps JS SDK. This handler is host-internal:
          // the LLM never legitimately calls it, but the runtime
          // dispatch route is auth'd by bearer token so a malicious
          // tool call would also need the local token. Per the plan
          // (Open Question #3), the v1 threat model is "local desktop
          // app, key delivery is direct return." Revisit if ever
          // running in a multi-user mode.
          const cfg = await readConfig();
          if (!cfg.googleMapsApiKey) return { ok: false, error: "not_configured" };
          return { ok: true, apiKey: cfg.googleMapsApiKey };
        }
        case "addFavorite": {
          return withWriteLock(async () => {
            const file = await readFavorites();
            const now = new Date().toISOString();
            const next: Favorite = {
              id: crypto.randomUUID(),
              name: args.name,
              lat: args.lat,
              lng: args.lng,
              placeId: args.placeId,
              tags: args.tags,
              notes: args.notes,
              addedAt: now,
              updatedAt: now,
            };
            const updated: FavoritesFile = { ...file, favorites: insertFavorite(file.favorites, next) };
            await writeFavorites(updated);
            log.info("favorite added", { id: next.id, name: next.name });
            return { ok: true, favorite: next };
          });
        }
        case "listFavorites": {
          const file = await readFavorites();
          return { ok: true, favorites: file.favorites };
        }
        case "removeFavorite": {
          return withWriteLock(async () => {
            const file = await readFavorites();
            const { next, removed } = removeFavoriteById(file.favorites, args.id);
            if (!removed) return { ok: false, error: "not_found" };
            await writeFavorites({ ...file, favorites: next });
            log.info("favorite removed", { id: args.id });
            return { ok: true };
          });
        }
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
