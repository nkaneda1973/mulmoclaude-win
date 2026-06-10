// Per-collection sort preference persisted to localStorage, keyed by
// collection slug. Lets the standalone `/collections/:slug` page reopen
// with the last-used sort instead of the default order. Embedded
// chat-card mode persists its own `viewState` and does NOT use this.

import type { CollectionItem, FieldSpec } from "../../components/collectionTypes";

export type SortDirection = "asc" | "desc";

export interface SortState {
  field: string;
  direction: SortDirection;
}

const STORAGE_KEY = "collection_sort_states";

type SortStateMap = Record<string, SortState>;

function readAll(): SortStateMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SortStateMap) : {};
  } catch {
    return {};
  }
}

function isValidSortState(value: unknown): value is SortState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.field === "string" && (obj.direction === "asc" || obj.direction === "desc");
}

export function readCollectionSort(slug: string): SortState | null {
  const stored = readAll()[slug];
  return isValidSortState(stored) ? stored : null;
}

export function writeCollectionSort(slug: string, sort: SortState | null): void {
  try {
    const all = readAll();
    if (sort) {
      all[slug] = sort;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- clearing a specific key from a string-keyed map
      delete all[slug];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort persistence.
  }
}

function toNumber(val: unknown): number {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

function toBoolean(val: unknown): boolean {
  return val === true;
}

function compareNumeric(valLeft: unknown, valRight: unknown): number {
  return toNumber(valLeft) - toNumber(valRight);
}

function compareBooleans(valLeft: unknown, valRight: unknown): number {
  if (toBoolean(valLeft) === toBoolean(valRight)) return 0;
  return toBoolean(valLeft) ? 1 : -1;
}

function compareEnumValues(valLeft: unknown, valRight: unknown, values: readonly string[]): number {
  const idxLeft = values.indexOf(String(valLeft));
  const idxRight = values.indexOf(String(valRight));
  const posLeft = idxLeft === -1 ? values.length : idxLeft;
  const posRight = idxRight === -1 ? values.length : idxRight;
  return posLeft - posRight;
}

function compareByType(valLeft: unknown, valRight: unknown, fieldSpec: FieldSpec): number {
  switch (fieldSpec.type) {
    case "number":
    case "money":
      return compareNumeric(valLeft, valRight);
    case "boolean":
    case "toggle":
      return compareBooleans(valLeft, valRight);
    case "enum":
      if (fieldSpec.values) return compareEnumValues(valLeft, valRight, fieldSpec.values);
      return String(valLeft).localeCompare(String(valRight));
    default:
      return String(valLeft).localeCompare(String(valRight));
  }
}

/** Compare two items for sorting by a given field. Null/undefined values
 *  always sort to the end regardless of direction. */
export function compareItems(itemLeft: CollectionItem, itemRight: CollectionItem, field: string, fieldSpec: FieldSpec, direction: SortDirection): number {
  const valLeft = itemLeft[field];
  const valRight = itemRight[field];
  const multiplier = direction === "asc" ? 1 : -1;

  if (valLeft == null && valRight == null) return 0;
  if (valLeft == null) return 1;
  if (valRight == null) return -1;

  return multiplier * compareByType(valLeft, valRight, fieldSpec);
}
