import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { compareItems, type SortDirection } from "../../src/utils/collections/collectionSort.js";
import type { CollectionItem, FieldSpec } from "../../src/components/collectionTypes.js";

function field(type: string, values?: readonly string[]): FieldSpec {
  return { type: type as FieldSpec["type"], label: type, values } as FieldSpec;
}

function compare(left: unknown, right: unknown, spec: FieldSpec, dir: SortDirection = "asc"): number {
  const itemLeft: CollectionItem = { val: left };
  const itemRight: CollectionItem = { val: right };
  return compareItems(itemLeft, itemRight, "val", spec, dir);
}

describe("compareItems", () => {
  describe("string fields", () => {
    const spec = field("string");
    test("sorts alphabetically ascending", () => {
      assert.ok(compare("apple", "banana", spec) < 0);
    });
    test("sorts alphabetically descending", () => {
      assert.ok(compare("apple", "banana", spec, "desc") > 0);
    });
    test("equal strings return 0", () => {
      assert.equal(compare("same", "same", spec), 0);
    });
  });

  describe("number fields", () => {
    const spec = field("number");
    test("sorts numerically ascending", () => {
      assert.ok(compare(1, 10, spec) < 0);
    });
    test("sorts numerically descending", () => {
      assert.ok(compare(1, 10, spec, "desc") > 0);
    });
    test("equal numbers return 0", () => {
      assert.equal(compare(5, 5, spec), 0);
    });
    test("non-finite values treated as 0", () => {
      assert.equal(compare("not-a-number", "also-not", spec), 0);
    });
  });

  describe("money fields", () => {
    const spec = field("money");
    test("sorts like numbers", () => {
      assert.ok(compare(100, 200, spec) < 0);
    });
  });

  describe("boolean fields", () => {
    const spec = field("boolean");
    test("false before true ascending", () => {
      assert.ok(compare(false, true, spec) < 0);
    });
    test("true before false descending", () => {
      assert.ok(compare(false, true, spec, "desc") > 0);
    });
    test("equal booleans return 0", () => {
      assert.equal(compare(true, true, spec), 0);
    });
  });

  describe("date fields", () => {
    const spec = field("date");
    test("sorts ISO date strings ascending", () => {
      assert.ok(compare("2024-01-01", "2024-12-31", spec) < 0);
    });
    test("sorts descending", () => {
      assert.ok(compare("2024-01-01", "2024-12-31", spec, "desc") > 0);
    });
  });

  describe("enum fields", () => {
    const spec = field("enum", ["todo", "in-progress", "done"]);
    test("sorts by declaration order ascending", () => {
      assert.ok(compare("todo", "done", spec) < 0);
      assert.ok(compare("in-progress", "done", spec) < 0);
    });
    test("unknown values sort after known values", () => {
      assert.ok(compare("done", "unknown-val", spec) < 0);
    });
    test("sorts descending", () => {
      assert.ok(compare("todo", "done", spec, "desc") > 0);
    });
    test("enum without values falls back to string compare", () => {
      const noValues = field("enum");
      assert.ok(compare("alpha", "beta", noValues) < 0);
    });
  });

  describe("null/undefined handling", () => {
    const spec = field("string");
    test("null sorts to the end regardless of direction", () => {
      assert.ok(compare(null, "value", spec) > 0);
      assert.ok(compare(null, "value", spec, "desc") > 0);
    });
    test("undefined sorts to the end", () => {
      assert.ok(compare(undefined, "value", spec) > 0);
    });
    test("both null returns 0", () => {
      assert.equal(compare(null, null, spec), 0);
    });
    test("null on right sorts to end", () => {
      assert.ok(compare("value", null, spec) < 0);
    });
  });

  describe("toggle fields", () => {
    const spec = field("toggle");
    test("sorts like boolean", () => {
      assert.ok(compare(false, true, spec) < 0);
    });
  });
});
