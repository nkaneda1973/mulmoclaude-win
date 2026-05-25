import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStackDisplayItems } from "../../../src/utils/canvas/stackGrouping.js";

// Minimal result shape the grouper needs.
interface Row {
  uuid: string;
  group: string | null;
}
const groupKeyOf = (row: Row): string | null => row.group;
const uuidOf = (row: Row): string => row.uuid;
const build = (rows: Row[]) => buildStackDisplayItems(rows, groupKeyOf, uuidOf);

describe("buildStackDisplayItems", () => {
  it("keeps ungrouped results as one card each, in order", () => {
    const items = build([
      { uuid: "a", group: null },
      { uuid: "b", group: null },
    ]);
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => item.head.uuid),
      ["a", "b"],
    );
    assert.equal(
      items.every((i) => !i.isGroup),
      true,
    );
    assert.equal(
      items.every((item) => item.members.length === 1),
      true,
    );
  });

  it("collapses consecutive same-group results into one card with members in order", () => {
    const items = build([
      { uuid: "a", group: "g1" },
      { uuid: "b", group: "g1" },
      { uuid: "c", group: "g1" },
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].isGroup, true);
    assert.deepEqual(
      items[0].members.map((member) => member.uuid),
      ["a", "b", "c"],
    );
    assert.equal(items[0].head.uuid, "c", "head is the latest member");
    assert.equal(items[0].key, "group:g1");
  });

  it("merges NON-contiguous same-group results at the first occurrence (Codex #1504)", () => {
    // A(g1), B(text), C(g1) → two cards: the g1 group [A, C] at index 0
    // (A's slot), and B at index 1. C must NOT create a third card, and
    // the group must stay at A's position so rendered order is
    // [g1, B] — what scroll-spy iterates.
    const items = build([
      { uuid: "a", group: "g1" },
      { uuid: "b", group: null },
      { uuid: "c", group: "g1" },
    ]);
    assert.equal(items.length, 2, "C merges into the existing g1 card, not a new one");
    assert.equal(items[0].key, "group:g1");
    assert.deepEqual(
      items[0].members.map((member) => member.uuid),
      ["a", "c"],
    );
    assert.equal(items[0].head.uuid, "c", "head follows the latest call");
    assert.equal(items[1].head.uuid, "b");
    assert.equal(items[1].isGroup, false);
  });

  it("keeps distinct groups as distinct cards in first-occurrence order", () => {
    const items = build([
      { uuid: "a", group: "g1" },
      { uuid: "b", group: "g2" },
      { uuid: "c", group: "g1" },
      { uuid: "d", group: "g2" },
    ]);
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => item.key),
      ["group:g1", "group:g2"],
    );
    assert.deepEqual(
      items[0].members.map((member) => member.uuid),
      ["a", "c"],
    );
    assert.deepEqual(
      items[1].members.map((member) => member.uuid),
      ["b", "d"],
    );
  });

  it("treats a lone grouped result as a (single-member) group card", () => {
    const items = build([{ uuid: "a", group: "g1" }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].isGroup, true);
    assert.equal(items[0].members.length, 1);
  });
});
