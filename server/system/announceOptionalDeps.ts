// Boot-time graceful-degradation announcement for missing optional
// host binaries (#1385). Probes the registry, then for each missing
// dependency emits one structured log.warn plus a deduped bell
// notification naming the affected feature/plugins. Never throws —
// degradation is the whole point.

import { BUILT_IN_PLUGIN_METAS } from "../../src/plugins/metas.js";
import type { PluginMeta } from "../../src/plugins/meta-types.js";
import { NOTIFICATION_PRIORITIES } from "../../src/types/notification.js";
import { log } from "./logger/index.js";
import { publishNotification } from "../events/notifications.js";
import { probeOptionalDeps, optionalDeps } from "./optionalDeps.js";

function pluginsRequiring(depId: string): string[] {
  const metas: readonly PluginMeta[] = Object.values(BUILT_IN_PLUGIN_METAS);
  return metas.filter((meta) => meta.requires?.includes(depId)).map((meta) => meta.toolName);
}

export async function announceOptionalDeps(): Promise<void> {
  const statuses = await probeOptionalDeps();
  for (const dep of optionalDeps()) {
    const status = statuses[dep.id];
    if (!status || status.available) continue;
    const affectedPlugins = pluginsRequiring(dep.id);
    log.warn("deps", `optional dependency '${dep.command}' unavailable — ${dep.enables} degraded`, {
      depId: dep.id,
      reason: status.reason,
      affectedPlugins,
    });
    publishNotification({
      id: `optional-dep-missing:${dep.id}`,
      kind: "system",
      priority: NOTIFICATION_PRIORITIES.normal,
      title: "Optional dependency missing",
      body: `${dep.command} not found — some features are disabled`,
      i18n: {
        titleKey: "optionalDeps.missingTitle",
        bodyKey: "optionalDeps.missingBody",
        bodyParams: { command: dep.command },
      },
    });
  }
}
