// Plugin server entry — runs inside the host's Node process.
//
// PR-A scope (#1227): API-key storage. The plugin owns
// `config/google-maps.json` (per-machine, never committed) and exposes
// two kinds:
//   - `configure({ apiKey })`  — store the key
//   - `status()`               — { configured: boolean }
//
// The key is returned to the View on a separate kind in PR-A's first
// follow-up (or via a host-side endpoint) so it can be embedded in the
// Maps JS SDK script tag. For PR-A we only need the round-trip storage
// proven; reading the key back happens in PR-B once `/map` actually
// renders a map.

import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const ConfigFile = z.object({
  version: z.literal(1),
  googleMapsApiKey: z.string().optional(),
});
type ConfigFile = z.infer<typeof ConfigFile>;

const Args = z.discriminatedUnion("kind", [z.object({ kind: z.literal("status") }), z.object({ kind: z.literal("configure"), apiKey: z.string().min(1) })]);

const CONFIG_FILE = "google-maps.json";
const DEFAULT_CONFIG: ConfigFile = { version: 1 };

export default definePlugin(({ pubsub, files, log }) => {
  // Serialise read-modify-write so two parallel `configure` calls
  // don't both load the same snapshot and silently drop one.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeLock.catch(() => undefined).then(fn);
    writeLock = next.catch(() => undefined);
    return next;
  }

  async function readConfig(): Promise<ConfigFile> {
    if (!(await files.config.exists(CONFIG_FILE))) return DEFAULT_CONFIG;
    const raw = await files.config.read(CONFIG_FILE);
    return ConfigFile.parse(JSON.parse(raw));
  }

  async function writeConfig(cfg: ConfigFile): Promise<void> {
    await files.config.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    // `configured-changed` lets the Settings UI in another tab refresh
    // its "Configured ✓" badge without the user touching it.
    pubsub.publish("configured-changed", { configured: Boolean(cfg.googleMapsApiKey) });
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
            // Don't echo the key back. The handler returns success
            // only; the View re-fetches `status` to update its UI.
            log.info("google maps api key configured");
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
