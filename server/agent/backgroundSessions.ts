// In-flight bookkeeping for detached worker sessions launched via the
// `spawnBackgroundChat` MCP tool with `hidden: true` (origin
// `system`). Both the tool handler (which reserves a slot before
// `startChat`) and `runAgentInBackground`'s `finally` (which releases
// it when the worker finishes) run in the same Express process, so
// this module-level Set is the single shared owner of the count.
//
// Purpose: a runaway guard. Without a cap, a misbehaving agent could
// fan out an unbounded number of parallel `claude` subprocesses. The
// cap is small on purpose — the intended use is "stay one or two
// lessons ahead", not a job queue.

const MAX_BACKGROUND_SESSIONS = 4;

const inFlight = new Set<string>();

/** True when there's room to launch another hidden worker session. */
export function canSpawnBackgroundSession(): boolean {
  return inFlight.size < MAX_BACKGROUND_SESSIONS;
}

/** Mark a hidden worker session as in-flight. Call only once the
 *  underlying `startChat` has actually launched (so a failed launch
 *  doesn't leak a slot). */
export function reserveBackgroundSession(chatSessionId: string): void {
  inFlight.add(chatSessionId);
}

/** Release a hidden worker session's slot. Idempotent / safe to call
 *  for non-background sessions (no-op when the id was never reserved),
 *  so the agent run's `finally` can call it without branching. */
export function releaseBackgroundSession(chatSessionId: string): void {
  inFlight.delete(chatSessionId);
}

export { MAX_BACKGROUND_SESSIONS };
