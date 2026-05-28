# Plan: Localize Encore plugin-seeded chat prompts (#1545)

## Background

Encore の `+ Add` / per-obligation chat / pending notification bell から開始するチャットは、英文の seed prompt を user の最初の発話として注入する。ブラウザ locale が `ja` / `zh` / `ko` 等でも seed が英文のままで、LLM 応答が英語にアンカリングされる。

## Approach

既存の `/api/translation/translate` インフラ（`server/services/translation/`）を流用し、handler 内部で seed prompt を user locale に翻訳してから `startChat` に渡す。失敗時は英文 fallback。

## Changes

### Server

- New `server/encore/handlers/seedTranslator.ts`
  - Lazy singleton `TranslationService`、namespace `encore-seed`
  - `translateSeedPrompt(prompt, locale)`：`locale` が unset / `en` で短絡、それ以外は翻訳サービス呼び出し、失敗 or 空文字は英文 fallback（never throws）
  - test 用 hook: `__setSeedTranslateBatchForTests(backend, workspaceRoot)` / `__resetSeedTranslatorForTests()`
- 3 handlers (`startSetupChat`, `startObligationChat`, `resolveNotification`)
  - Args schema に `locale: z.string().optional()` を追加
  - `startChat({ message })` 前に `translateSeedPrompt` を挟む

### Frontend

- `EncoreDashboard.vue`：`useI18n()` から `locale` を取り、`startObligationChat` / `startSetupChat` dispatch body に `locale: locale.value` を付与
- `EncoreRedirect.vue`：同上で `resolveNotification` dispatch に追加

### Tests

- `test/plugins/test_encore_seed_translator.ts`：translator 単体テスト（locale 短絡 / 翻訳成功 / backend throw / 空翻訳 fallback の 5 ケース）。handler 自体は `startChat` 経由で実 LLM を起動するため component test では covered せず、既存方針（`test_encore_dispatch.ts` 末尾コメント参照）に従う。

## Items to confirm

- namespace 名: `encore-seed`（将来 plugin-seed 汎用化の余地は残るが、現状 Encore 専用）
- `personal` role system prompt への "reply in user's language" 追加は今回 scope 外
- `startObligationChat` の seed prompt は obligationId + displayName を含むため cache hit 率は obligation 単位（初回 click のみ翻訳）
