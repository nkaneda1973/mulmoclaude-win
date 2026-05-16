// Encore-scoped notifier wrapper.
//
// Closes over:
//   - `pluginPkg`: a constant identity string so every Encore-owned
//     bell entry is tagged uniformly, and `clearForPlugin` can
//     enforce plugin-scoped clearing.
//   - lifecycle derivation: severity=info → lifecycle=fyi, otherwise
//     lifecycle=action. The host's `validateActionCoherence` rejects
//     `action` + `info` pairs (see server/notifier/engine.ts), so we
//     derive lifecycle from severity at publish time instead of
//     accepting it as an arg from callers.
//
// Pure passthrough otherwise — no caching, no batching, no other
// semantics. Tick + handlers import this module rather than
// reaching for the raw host engine.

import * as engine from "../notifier/engine.js";
import type { Severity } from "./dsl/schema.js";

/** Identity string used as `pluginPkg` on every Encore bell entry.
 *  Stable across versions; lives next to the apiNamespace ("encore")
 *  and the tool name ("manageEncore") as part of the plugin's
 *  identity. */
export const ENCORE_PLUGIN_PKG = "encore" as const;

export interface PublishArgs {
  severity: Severity;
  title: string;
  body?: string;
  navigateTarget: string;
  pluginData?: unknown;
}

/** Map Encore's DSL-facing severity vocabulary
 *  (`info | warning | urgent`, picked for clarity in plain-language
 *  prompts the LLM composes against) to the host notifier's
 *  vocabulary (`info | nudge | urgent`). The host's `nudge` is the
 *  mid-intensity bucket; aliasing keeps the DSL stable without
 *  drifting from the host's naming. */
function toHostSeverity(severity: Severity): "info" | "nudge" | "urgent" {
  if (severity === "warning") return "nudge";
  return severity;
}

/** Publish an Encore notification. Lifecycle is derived from
 *  severity per the host's coherence rule. Returns the host-assigned
 *  notification id. */
export async function publish(args: PublishArgs): Promise<{ id: string }> {
  const lifecycle = args.severity === "info" ? "fyi" : "action";
  return engine.publish({
    pluginPkg: ENCORE_PLUGIN_PKG,
    severity: toHostSeverity(args.severity),
    lifecycle,
    title: args.title,
    body: args.body,
    navigateTarget: args.navigateTarget,
    pluginData: args.pluginData,
  });
}

/** Clear an Encore notification. No-ops on unknown / cross-plugin
 *  ids — matches host `clearForPlugin` semantics, plugin can't
 *  dismiss another plugin's entries. */
export async function clear(entryId: string): Promise<void> {
  await engine.clearForPlugin(ENCORE_PLUGIN_PKG, entryId);
}
