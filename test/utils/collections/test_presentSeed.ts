// Covers the client-side presentCollection seeding: parsing a collection
// slash-command chat seed, building the synthetic placeholder card, and the
// option-2 reconcile that drops the placeholder when the agent's real
// presentCollection result arrives (so the two don't stack).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCollectionSlashSeed, makeSyntheticCollectionResult, reconcileSyntheticCollection } from "../../../src/utils/collections/presentSeed.js";
import { createEmptySession } from "../../../src/utils/session/sessionFactory.js";
import { TOOL_NAME as PRESENT_COLLECTION } from "@mulmoclaude/collection-plugin";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

describe("parseCollectionSlashSeed", () => {
  it("parses a bare slash command", () => {
    assert.deepEqual(parseCollectionSlashSeed("/clients"), { slug: "clients" });
  });

  it("parses a slash command with a trailing message", () => {
    assert.deepEqual(parseCollectionSlashSeed("/clients add a new lead"), { slug: "clients" });
  });

  it("extracts an immediate id= selector", () => {
    assert.deepEqual(parseCollectionSlashSeed("/invoices id=inv_42 mark as paid"), { slug: "invoices", itemId: "inv_42" });
  });

  it("ignores id= that is not the first token after the slug", () => {
    assert.deepEqual(parseCollectionSlashSeed("/invoices mark id=inv_42"), { slug: "invoices" });
  });

  it("returns null for plain prose and path-like input", () => {
    assert.equal(parseCollectionSlashSeed("just chatting"), null);
    assert.equal(parseCollectionSlashSeed("/"), null);
    assert.equal(parseCollectionSlashSeed("/foo/bar"), null);
  });
});

describe("makeSyntheticCollectionResult", () => {
  it("builds a presentCollection-shaped card the View can render from", () => {
    const card = makeSyntheticCollectionResult("clients", "c_1");
    assert.equal(card.toolName, PRESENT_COLLECTION);
    assert.deepEqual(card.data, { collectionSlug: "clients", itemId: "c_1" });
    assert.deepEqual(card.jsonData, { collectionSlug: "clients", itemId: "c_1" });
    assert.ok(card.uuid.length > 0);
  });

  it("omits itemId when not given", () => {
    assert.deepEqual(makeSyntheticCollectionResult("clients").data, { collectionSlug: "clients" });
  });
});

// Build a real (non-synthetic) presentCollection result as the agent would emit.
function realResult(slug: string): ToolResultComplete {
  return { uuid: `real-${slug}`, toolName: PRESENT_COLLECTION, message: `Presented ${slug}`, data: { collectionSlug: slug } };
}

describe("reconcileSyntheticCollection", () => {
  it("drops the placeholder for the same slug and clears its selection", () => {
    const session = createEmptySession("s1", "general");
    const placeholder = makeSyntheticCollectionResult("clients");
    session.toolResults.push(placeholder);
    session.resultTimestamps.set(placeholder.uuid, 1);
    session.selectedResultUuid = placeholder.uuid;

    reconcileSyntheticCollection(session, realResult("clients"));

    assert.equal(session.toolResults.length, 0);
    assert.equal(session.resultTimestamps.has(placeholder.uuid), false);
    assert.equal(session.selectedResultUuid, null);
  });

  it("leaves placeholders for other collections untouched", () => {
    const session = createEmptySession("s1", "general");
    const placeholder = makeSyntheticCollectionResult("invoices");
    session.toolResults.push(placeholder);

    reconcileSyntheticCollection(session, realResult("clients"));

    assert.equal(session.toolResults.length, 1);
    assert.equal(session.toolResults[0].uuid, placeholder.uuid);
  });

  it("ignores a synthetic incoming result (no self-reconcile)", () => {
    const session = createEmptySession("s1", "general");
    const placeholder = makeSyntheticCollectionResult("clients");
    session.toolResults.push(placeholder);

    reconcileSyntheticCollection(session, makeSyntheticCollectionResult("clients"));

    assert.equal(session.toolResults.length, 1);
  });
});
