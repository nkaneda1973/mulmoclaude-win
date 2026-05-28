// Localizes Encore plugin-seeded chat prompts (startSetupChat /
// startObligationChat / resolveNotification) into the user's browser
// locale before the seed turn is written to the chat session.
//
// Without this, the LLM anchors its first reply to the English seed
// language even when the user's UI is in ja / zh / ko / etc. — the
// skill-style card also shows the English source, which is jarring.
//
// Backed by the same on-disk translation cache as Role suggested
// queries (`server/services/translation/`). Failures fall back to the
// English source — same policy as `useTranslatedQueries`.

import { createTranslationService } from "../../services/translation/index.js";
import { defaultTranslateBatch } from "../../services/translation/llm.js";
import { log } from "../../system/logger/index.js";
import type { TranslateBatchFn, TranslationService } from "../../services/translation/types.js";

const NAMESPACE = "encore-seed";
const SOURCE_LANGUAGE = "en";

let cachedService: TranslationService | null = null;
let translateBatchOverride: TranslateBatchFn | null = null;
let workspaceRootOverride: string | undefined;

function getService(): TranslationService {
  if (!cachedService) {
    cachedService = createTranslationService({
      translateBatch: translateBatchOverride ?? defaultTranslateBatch,
      workspaceRoot: workspaceRootOverride,
    });
  }
  return cachedService;
}

/** Translate an English seed prompt into `locale`. Returns the original
 *  prompt when `locale` is unset, `en`, or the translation backend
 *  fails — never throws. */
export async function translateSeedPrompt(prompt: string, locale: string | undefined): Promise<string> {
  if (!locale || locale === SOURCE_LANGUAGE) return prompt;
  try {
    const { translations } = await getService().translate({
      namespace: NAMESPACE,
      targetLanguage: locale,
      sentences: [prompt],
    });
    const [translated] = translations;
    return translated && translated.length > 0 ? translated : prompt;
  } catch (err) {
    log.warn("encore", "seed prompt translation failed; falling back to English", {
      locale,
      error: err instanceof Error ? err.message : String(err),
    });
    return prompt;
  }
}

// ── Test-only hooks ─────────────────────────────────────────────────

export function __setSeedTranslateBatchForTests(backend: TranslateBatchFn | null, workspaceRoot?: string): void {
  translateBatchOverride = backend;
  workspaceRootOverride = workspaceRoot;
  cachedService = null;
}

export function __resetSeedTranslatorForTests(): void {
  translateBatchOverride = null;
  workspaceRootOverride = undefined;
  cachedService = null;
}
