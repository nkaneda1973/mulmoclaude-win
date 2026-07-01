// Pins `connectSession`'s two-mode contract added for #1888:
//   - roleId passed → persisted state's role is replaced by the caller's value
//   - roleId omitted → persisted state's role is preserved (HTTP /connect path)
// The rest of `chat-state.ts` is exercised through the surrounding command +
// relay tests; this file only guards the roleId propagation semantics.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createChatStateStore } from "../src/chat-state.ts";
import type { Logger } from "../src/types.ts";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("chat-state.connectSession — roleId propagation (issue #1888)", () => {
  let transportsDir: string;

  beforeEach(() => {
    transportsDir = mkdtempSync(path.join(tmpdir(), "chat-state-"));
  });

  afterEach(() => {
    rmSync(transportsDir, { recursive: true, force: true });
  });

  it("replaces roleId when the caller passes one (the /switch path)", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    await store.resetChatState("telegram", "chat-1", "general");
    const updated = await store.connectSession("telegram", "chat-1", "office-session", "office");
    assert.ok(updated);
    assert.equal(updated?.sessionId, "office-session");
    assert.equal(updated?.roleId, "office", "the target session's role must overwrite the prior role");
    // Re-read to confirm the file-backed copy matches (this is the value the
    // next relay's startChat will pick up).
    const reloaded = await store.getChatState("telegram", "chat-1");
    assert.equal(reloaded?.roleId, "office");
  });

  it("preserves roleId when the caller omits it (the HTTP /connect path)", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    await store.resetChatState("telegram", "chat-1", "general");
    const updated = await store.connectSession("telegram", "chat-1", "some-session");
    assert.ok(updated);
    assert.equal(updated?.sessionId, "some-session");
    assert.equal(updated?.roleId, "general", "omitted roleId ⇒ keep the existing one (backward-compat for /connect)");
  });

  it("returns null when the chat state doesn't exist yet", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    const result = await store.connectSession("telegram", "never-seen", "sess", "office");
    assert.equal(result, null);
  });
});
