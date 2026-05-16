// Wire the Encore tick into the host task-manager at server boot.
// Called from `server/index.ts` after the task-manager is created
// but before `taskManager.start()`.
//
// The tick goes through the per-plugin mutex (`kickTickLocked`) so
// it serialises with handler-side mutations. Same hourly heartbeat
// any other Encore tick would use; the dispatch handlers' kick is a
// best-effort optimisation that surfaces newly-due notifications
// within the same SSE turn as the mutation that caused them.

import type { ITaskManager } from "../events/task-manager/index.js";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";
import { ONE_HOUR_MS } from "../utils/time.js";
import { kickTickLocked } from "./lock.js";

const ENCORE_TICK_ID = "encore-tick";

export function registerEncoreTick(taskManager: ITaskManager): void {
  taskManager.registerTask({
    id: ENCORE_TICK_ID,
    description: "Encore — fire and escalate notifications based on each obligation's firingPlan.",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS },
    run: async ({ now }) => {
      await kickTickLocked({ now }, "encore-tick heartbeat");
    },
  });
}
