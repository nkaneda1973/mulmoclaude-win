// @package-contract — see ./types.ts
//
// Persists per-transport chat state (which session a given
// external chat id currently points at, which role, timestamps).
// Kept DI-pure so the module can be extracted as a standalone npm
// package: the transports directory path and logger arrive via the
// factory, never through a direct `../workspace-paths.js` import.

import { mkdir, readFile } from "fs/promises";
import path from "path";
import { writeFileAtomic } from "./atomic-write.js";
import type { Logger } from "./types.js";

// ── Types ────────────────────────────────────────────────────

export interface TransportChatState {
  externalChatId: string;
  sessionId: string;
  roleId: string;
  claudeSessionId?: string;
  startedAt: string;
  updatedAt: string;
}

export interface ChatStateStore {
  getChatState(transportId: string, externalChatId: string): Promise<TransportChatState | null>;
  setChatState(transportId: string, state: TransportChatState): Promise<void>;
  resetChatState(transportId: string, externalChatId: string, roleId: string): Promise<TransportChatState>;
  /** Repoint the persisted chat state at another session. `roleId` is
   *  optional: when omitted, the existing state's roleId is preserved
   *  (the old default, kept for HTTP `/connect` callers that only know
   *  the session ID). Callers that DO know the target session's role —
   *  notably the `/switch` command, which already has `SessionSummary.roleId`
   *  from `/sessions` — MUST pass it, otherwise the file-backed state
   *  drifts into a stale-role / new-session pair and the next relay's
   *  `startChat` uses the mismatched pair (issue #1888). */
  connectSession(transportId: string, externalChatId: string, chatSessionId: string, roleId?: string): Promise<TransportChatState | null>;
  generateSessionId(transportId: string, externalChatId: string): string;
}

// ── Path / id helpers ────────────────────────────────────────

// Allow alphanumeric, hyphen, underscore, dot. Rejects empty
// strings and anything >200 chars so we never let a transport id
// escape the transports directory via path traversal.
function isSafeId(id: string): boolean {
  return /^[\w.-]+$/.test(id) && id.length > 0 && id.length <= 200;
}

// ── Factory ──────────────────────────────────────────────────

export function createChatStateStore(opts: { transportsDir: string; logger: Logger }): ChatStateStore {
  const { transportsDir, logger } = opts;

  const transportDir = (transportId: string) => path.join(transportsDir, transportId, "chats");

  const statePath = (transportId: string, externalChatId: string) => path.join(transportDir(transportId), `${externalChatId}.json`);

  const generateSessionId = (transportId: string, externalChatId: string): string => `${transportId}-${externalChatId}-${Date.now()}`;

  const getChatState = async (transportId: string, externalChatId: string): Promise<TransportChatState | null> => {
    if (!isSafeId(transportId) || !isSafeId(externalChatId)) return null;
    try {
      const raw = await readFile(statePath(transportId, externalChatId), "utf-8");
      const parsed: TransportChatState = JSON.parse(raw);
      return parsed;
    } catch {
      return null;
    }
  };

  const setChatState = async (transportId: string, state: TransportChatState): Promise<void> => {
    if (!isSafeId(transportId) || !isSafeId(state.externalChatId)) {
      throw new Error("Invalid transport or chat ID");
    }
    await mkdir(transportDir(transportId), { recursive: true });
    await writeFileAtomic(statePath(transportId, state.externalChatId), JSON.stringify(state, null, 2));
  };

  const resetChatState = async (transportId: string, externalChatId: string, roleId: string): Promise<TransportChatState> => {
    const now = new Date().toISOString();
    const state: TransportChatState = {
      externalChatId,
      sessionId: generateSessionId(transportId, externalChatId),
      roleId,
      startedAt: now,
      updatedAt: now,
    };
    await setChatState(transportId, state);
    logger.info("chat-state", "reset", {
      transportId,
      externalChatId,
      sessionId: state.sessionId,
    });
    return state;
  };

  const connectSession = async (transportId: string, externalChatId: string, chatSessionId: string, roleId?: string): Promise<TransportChatState | null> => {
    const existing = await getChatState(transportId, externalChatId);
    if (!existing) return null;
    const updated: TransportChatState = {
      ...existing,
      sessionId: chatSessionId,
      // A missing `roleId` arg means "preserve the current role" (that's
      // the HTTP `/connect` route, which doesn't know the target's role);
      // when the caller passes one (`/switch`), take theirs so state and
      // downstream `startChat` agree on which role runs the resumed session.
      ...(roleId !== undefined ? { roleId } : {}),
      updatedAt: new Date().toISOString(),
    };
    await setChatState(transportId, updated);
    logger.info("chat-state", "connected", {
      transportId,
      externalChatId,
      sessionId: chatSessionId,
      roleId: updated.roleId,
    });
    return updated;
  };

  return {
    getChatState,
    setChatState,
    resetChatState,
    connectSession,
    generateSessionId,
  };
}
