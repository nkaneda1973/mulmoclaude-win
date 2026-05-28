// Handler-level tests that the three Encore chat-start handlers
// (startSetupChat / startObligationChat / resolveNotification) thread
// the dispatch-body `locale` arg through to the seed translator and
// pass the translated text to `startChat`.
//
// The real `startChat` is replaced via `__setStartChatForTests` (it
// would otherwise write a session file under ~/mulmoclaude/ and spawn
// the Claude agent). Translation is intercepted via the seed
// translator's own test seam — same pattern as
// test_encore_seed_translator.ts.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { dispatch, type EncoreDispatchResult } from "../../server/encore/dispatch.js";
import { _setFilePathsForTesting } from "../../server/notifier/engine.js";
import { _resetLockForTesting } from "../../server/encore/lock.js";
import { __setStartChatForTests } from "../../server/encore/handlers/chatSeeder.js";
import { __resetSeedTranslatorForTests, __setSeedTranslateBatchForTests } from "../../server/encore/handlers/seedTranslator.js";
import type { StartChatParams, StartChatResult } from "../../server/api/routes/agent.js";
import type { TranslateBatchFn } from "../../server/services/translation/types.js";

let savedEncoreDescriptor: PropertyDescriptor | undefined;
let workspaceRoot: string;
let startChatCalls: StartChatParams[];

const recordingStartChat = async (params: StartChatParams): Promise<StartChatResult> => {
  startChatCalls.push(params);
  return { kind: "started", chatSessionId: params.chatSessionId };
};

const tagWithLocaleBackend: TranslateBatchFn = async (input) => input.sentences.map((sentence) => `[${input.targetLanguage}]${sentence}`);

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "encore-locale-")));
  savedEncoreDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "encore");
  Object.defineProperty(WORKSPACE_PATHS, "encore", {
    ...savedEncoreDescriptor,
    value: path.join(workspaceRoot, "data/plugins/encore"),
  });
  _setFilePathsForTesting({
    active: path.join(workspaceRoot, "notifier-active.json"),
    history: path.join(workspaceRoot, "notifier-history.json"),
  });
  _resetLockForTesting();
  startChatCalls = [];
  __setStartChatForTests(recordingStartChat);
  __setSeedTranslateBatchForTests(tagWithLocaleBackend, workspaceRoot);
});

afterEach(() => {
  if (savedEncoreDescriptor) Object.defineProperty(WORKSPACE_PATHS, "encore", savedEncoreDescriptor);
  __setStartChatForTests(null);
  __resetSeedTranslatorForTests();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const hisayoDefinition = {
  version: 1,
  displayName: "Daily payment — Hisayo",
  type: "payment",
  currency: "JPY",
  cadence: { type: "daily" },
  targets: [{ id: "hisayo", displayName: "Hisayo", defaults: { method: "Cash" } }],
  steps: [
    {
      id: "pay",
      displayName: "Pay",
      deadline: "cycle-deadline",
      firingPlan: [{ at: "cycle-start", severity: "info" }],
      fields: ["amount", "method", "paidOn"],
    },
  ],
  formSchema: {
    fields: [
      { name: "amount", type: "number", label: "Amount paid (JPY)", required: true },
      { name: "method", type: "string", label: "Payment method" },
      { name: "paidOn", type: "date", label: "Payment date" },
    ],
  },
};

interface SetupResult extends EncoreDispatchResult {
  obligationId?: string;
}

describe("Encore chat-start handlers — locale threading", () => {
  it("startSetupChat: locale=ja translates the English seed before startChat", async () => {
    const result = await dispatch({ kind: "startSetupChat", locale: "ja" });
    assert.equal(result.ok, true);
    assert.equal(startChatCalls.length, 1);
    assert.match(startChatCalls[0].message, /^\[ja\]I'd like to set up a new recurring obligation/);
  });

  it("startSetupChat: locale=en short-circuits — message is the English source", async () => {
    const result = await dispatch({ kind: "startSetupChat", locale: "en" });
    assert.equal(result.ok, true);
    assert.equal(startChatCalls.length, 1);
    assert.match(startChatCalls[0].message, /^I'd like to set up a new recurring obligation/);
  });

  it("startSetupChat: omitted locale leaves the English source unchanged", async () => {
    const result = await dispatch({ kind: "startSetupChat" });
    assert.equal(result.ok, true);
    assert.match(startChatCalls[0].message, /^I'd like to set up a new recurring obligation/);
  });

  it("startObligationChat: locale=ja translates the per-obligation seed before startChat", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    assert.ok(setup.obligationId, "setup must return an obligationId");
    startChatCalls = []; // ignore the setup-side seed; we only care about the click after.

    const result = await dispatch({
      kind: "startObligationChat",
      obligationId: setup.obligationId,
      locale: "ja",
    });
    assert.equal(result.ok, true);
    assert.equal(startChatCalls.length, 1);
    assert.match(startChatCalls[0].message, /^\[ja\]Let's talk about my "Daily payment — Hisayo" obligation/);
  });

  it("resolveNotification: locale=ja translates the ticket's seed prompt before startChat", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    assert.ok(setup.obligationId);
    // setup fires the initial tick, which writes a ticket whose
    // pendingId we read directly off disk — same trick the existing
    // dispatch test uses (see test_encore_dispatch.ts).
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const { promises: fsPromises } = await import("node:fs");
    const entries = await fsPromises.readdir(pendingDir);
    assert.equal(entries.length, 1, "setup should produce exactly one ticket");
    const raw = await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8");
    const ticket = JSON.parse(raw) as { pendingId: string; seedPrompt: string };
    startChatCalls = [];

    const result = await dispatch({
      kind: "resolveNotification",
      pendingId: ticket.pendingId,
      locale: "ja",
    });
    assert.equal(result.ok, true);
    assert.equal(startChatCalls.length, 1);
    // The translator splits on blank-line paragraph boundaries before
    // translating (the ticket seed exceeds the per-sentence cap), so
    // every paragraph independently picks up the `[ja]` tag.
    const expected = ticket.seedPrompt
      .split("\n\n")
      .map((paragraph) => (paragraph.length > 0 ? `[ja]${paragraph}` : paragraph))
      .join("\n\n");
    assert.equal(startChatCalls[0].message, expected);
  });
});
