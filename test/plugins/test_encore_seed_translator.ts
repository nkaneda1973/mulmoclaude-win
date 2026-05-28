// Unit tests for the Encore seed-prompt translator. The three
// chat-start handlers (startSetupChat / startObligationChat /
// resolveNotification) are not covered by component tests because they
// spawn the real Claude agent (see the note in test_encore_dispatch.ts).
// This file pins the translation-only seam instead.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { __resetSeedTranslatorForTests, __setSeedTranslateBatchForTests, translateSeedPrompt } from "../../server/encore/handlers/seedTranslator.js";
import type { TranslateBatchFn } from "../../server/services/translation/types.js";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-encore-seed-")));
});

afterEach(() => {
  __resetSeedTranslatorForTests();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function setBackend(backend: TranslateBatchFn): void {
  __setSeedTranslateBatchForTests(backend, workspaceRoot);
}

describe("Encore seed translator", () => {
  it("returns the source unchanged when locale is undefined", async () => {
    const calls: string[] = [];
    const fake: TranslateBatchFn = async (input) => {
      calls.push(...input.sentences);
      return input.sentences.map((sentence) => `[xx]${sentence}`);
    };
    setBackend(fake);

    const result = await translateSeedPrompt("hello", undefined);

    assert.equal(result, "hello");
    assert.deepEqual(calls, [], "translator must short-circuit before hitting the backend");
  });

  it("returns the source unchanged when locale === en", async () => {
    const fake: TranslateBatchFn = async () => {
      throw new Error("must not be called for en");
    };
    setBackend(fake);

    const result = await translateSeedPrompt("hello", "en");

    assert.equal(result, "hello");
  });

  it("returns the translated sentence when locale is non-en", async () => {
    const fake: TranslateBatchFn = async (input) => input.sentences.map((sentence) => `[${input.targetLanguage}]${sentence}`);
    setBackend(fake);

    const result = await translateSeedPrompt("Open the obligation.", "ja");

    assert.equal(result, "[ja]Open the obligation.");
  });

  it("falls back to the English source when the backend throws", async () => {
    const fake: TranslateBatchFn = async () => {
      throw new Error("backend down");
    };
    setBackend(fake);

    const result = await translateSeedPrompt("Important seed.", "ja");

    assert.equal(result, "Important seed.", "failure must not propagate — chat must still start");
  });

  it("falls back to the English source when the backend returns an empty translation", async () => {
    const fake: TranslateBatchFn = async (input) => input.sentences.map(() => "");
    setBackend(fake);

    const result = await translateSeedPrompt("Important seed.", "ja");

    assert.equal(result, "Important seed.");
  });
});
