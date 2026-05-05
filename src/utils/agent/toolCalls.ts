// Pure helpers for the agent's tool-call history manipulation
// pulled out of `src/App.vue#sendMessage`. Each function is
// single-purpose, testable in isolation, and side-effect-free.
//
// Extracted as part of the cognitive-complexity refactor tracked
// in #175.

import type { ToolCallHistoryItem } from "../../types/toolCallHistory";
import type { SseToolCall } from "../../types/sse";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// Convert an SSE tool_call event into a ToolCallHistoryItem ready
// to push onto a session's toolCallHistory. Pure.
export function toToolCallEntry(event: SseToolCall): ToolCallHistoryItem {
  return {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    args: event.args,
    timestamp: Date.now(),
  };
}

// When an SSE `tool_call_result` event arrives, the server tells
// us which tool call it belongs to via `toolUseId`. Find the most
// recent matching history entry that's still **pending** (no
// result, no error) and return it so the caller can attach the
// payload.
//
// Newest-first: scanning in reverse is intentional — two calls to
// the same tool within one run would otherwise attach the new
// result to the earlier entry. Reverse scan always picks the
// freshest pending entry, matching the server's LIFO ordering.
//
// Returns `undefined` when no pending call matches (race / retry /
// late-arriving event). Pure.
export function findPendingToolCall(history: readonly ToolCallHistoryItem[], toolUseId: string): ToolCallHistoryItem | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.toolUseId === toolUseId && entry.result === undefined && entry.error === undefined) {
      return entry;
    }
  }
  return undefined;
}

// Decide whether a newly-arrived assistant text message should
// become the selected canvas result. Rule: yes, iff no
// sidebar-*visible* plugin tool result has landed during this
// run. A visible plugin result — e.g. an image, a todo list
// update — is visually richer than a bare text response and
// should stay selected once emitted. Sidebar-hidden results
// (e.g. accounting `getReport`, which carries no `data` field)
// have no card on canvas, so they must not block selection of
// the text reply — otherwise selection silently sticks on a
// prior-turn card the user can no longer act on.
//
// `runStartIndex` is the index into `toolResults` at which the
// current run's outputs begin. Results before that index belong
// to previous turns and don't count.
//
// `isVisible` mirrors the predicate used by
// `applyToolResultToSession`'s auto-select branch so the two
// stay aligned. Default `() => true` matches the legacy
// behaviour (used by tests that don't care about visibility).
//
// Pure — returns a boolean for the caller to act on.
export function shouldSelectAssistantText(
  toolResults: readonly ToolResultComplete[],
  runStartIndex: number,
  isVisible: (result: ToolResultComplete) => boolean = () => true,
): boolean {
  for (let i = runStartIndex; i < toolResults.length; i++) {
    const result = toolResults[i];
    if (result.toolName === "text-response") continue;
    if (!isVisible(result)) continue;
    return false;
  }
  return true;
}
