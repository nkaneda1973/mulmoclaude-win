// Shared "translate seed prompt → startChat" envelope used by the
// three Encore chat-start handlers (startSetupChat / startObligationChat /
// resolveNotification). Extracted so the locale-threading path has
// one place to test against without spinning up the real Claude agent
// (the actual `startChat` call is replaceable via the test seam below).

import { startChat as defaultStartChat, type StartChatResult } from "../../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../../src/config/roles.js";
import { ENCORE_PLUGIN_PKG } from "../notifier.js";
import { translateSeedPrompt } from "./seedTranslator.js";

type StartChatFn = typeof defaultStartChat;

let startChatImpl: StartChatFn = defaultStartChat;

export interface SeedChatParams {
  readonly seedPrompt: string;
  readonly locale: string | undefined;
  readonly chatSessionId: string;
}

export async function seedChat(params: SeedChatParams): Promise<StartChatResult> {
  const message = await translateSeedPrompt(params.seedPrompt, params.locale);
  return startChatImpl({
    message,
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId: params.chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
}

// ── Test-only hooks ─────────────────────────────────────────────────

export function __setStartChatForTests(impl: StartChatFn | null): void {
  startChatImpl = impl ?? defaultStartChat;
}
