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

import {
  __resetSeedTranslatorForTests,
  __setSeedTranslateBatchForTests,
  stitchParagraphs,
  translateSeedPrompt,
} from "../../server/encore/handlers/seedTranslator.js";
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

  it("splits on paragraph boundaries so long ticket seeds clear the per-sentence cap", async () => {
    const seen: string[][] = [];
    const fake: TranslateBatchFn = async (input) => {
      seen.push([...input.sentences]);
      return input.sentences.map((sentence) => `[ja]${sentence}`);
    };
    setBackend(fake);

    const result = await translateSeedPrompt("first paragraph.\n\nsecond paragraph.\n\nthird.", "ja");

    assert.deepEqual(seen, [["first paragraph.", "second paragraph.", "third."]]);
    assert.equal(result, "[ja]first paragraph.\n\n[ja]second paragraph.\n\n[ja]third.");
  });

  it("falls back to the English source when the backend returns an empty translation", async () => {
    const fake: TranslateBatchFn = async (input) => input.sentences.map(() => "");
    setBackend(fake);

    const result = await translateSeedPrompt("Important seed.", "ja");

    assert.equal(result, "Important seed.");
  });
});

describe("stitchParagraphs (pure helper)", () => {
  it("interleaves translations against non-empty paragraphs in order", () => {
    const result = stitchParagraphs(["alpha", "beta", "gamma"], ["[A]", "[B]", "[G]"]);
    assert.equal(result, "[A]\n\n[B]\n\n[G]");
  });

  it("preserves empty paragraphs without consuming a translation slot", () => {
    // Splitting "a\n\n\n\nb" yields ["a", "", "b"] — the middle empty
    // entry must stay empty and the second translation must apply to
    // "b", not get swallowed by the gap.
    const result = stitchParagraphs(["a", "", "b"], ["[A]", "[B]"]);
    assert.equal(result, "[A]\n\n\n\n[B]");
  });

  it("falls back to the source paragraph when its translation slot is missing", () => {
    // Translation backend returned fewer entries than non-empty paragraphs.
    const result = stitchParagraphs(["one", "two", "three"], ["[1]", "[2]"]);
    assert.equal(result, "[1]\n\n[2]\n\nthree");
  });

  it("falls back to the source paragraph when its translation is empty", () => {
    const result = stitchParagraphs(["alpha", "beta"], ["[A]", ""]);
    assert.equal(result, "[A]\n\nbeta");
  });
});
