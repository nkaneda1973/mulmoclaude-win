// `startSetupChat` handler — user-initiated chat for creating a new
// obligation. Reached from the dashboard "+ Add" button (`/encore`
// landing); NOT exposed in the LLM-facing tool schema.
//
// Parallel to `startObligationChat` (which discusses an existing
// obligation) — this one has no obligation yet, so the seed prompt
// only asks the LLM to walk the user through setup. The LLM has
// the encore-dsl help file + `manageEncore({kind:"setup"})` already
// in its toolbelt; we don't need to teach it the schema here.

import { z } from "zod";
import { randomUUID } from "node:crypto";

import { startChat } from "../../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../../src/config/roles.js";
import { ENCORE_PLUGIN_PKG } from "../notifier.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, type EncoreDispatchResult } from "./shared.js";
import { translateSeedPrompt } from "./seedTranslator.js";

export const StartSetupChatArgs = z.object({
  kind: z.literal("startSetupChat"),
  /** Browser UI locale (BCP-47) — used to localize the seed prompt so
   *  the LLM's first reply isn't anchored to English. Optional;
   *  unset / `en` skips translation. */
  locale: z.string().optional(),
});

const SEED_PROMPT =
  "I'd like to set up a new recurring obligation in Encore. " +
  "Please walk me through what to track (kind, cadence, targets, fields), " +
  "then compose the DSL and call defineEncore when ready.";

export async function handleStartSetupChat(args: z.infer<typeof StartSetupChatArgs>): Promise<EncoreDispatchResult> {
  const chatSessionId = randomUUID();
  const message = await translateSeedPrompt(SEED_PROMPT, args.locale);
  const result = await startChat({
    message,
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
  if (result.kind === "error") {
    throw new EncoreError(result.status ?? 500, `startSetupChat: startChat failed — ${result.error}`);
  }

  log.info("encore", "startSetupChat: chat seeded", { chatSessionId });

  return {
    ok: true,
    message: `Encore: opened setup chat ${chatSessionId}.`,
    chatId: chatSessionId,
    navigateTo: `/chat/${chatSessionId}`,
  };
}
