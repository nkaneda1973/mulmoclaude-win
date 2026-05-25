// Collapse a flat tool-result list into the cards StackView renders.
//
// Most results are their own card. Results that share a non-null
// group key (today: `mapControl` results with the same `groupId`)
// collapse into ONE card, positioned at the group's FIRST occurrence,
// with every later same-group result appended to `members` in order.
// `head` is the latest member (drives the card header + the View's
// legacy single-result fields).
//
// Grouping is session-wide, not contiguous: `A(g1), B, C(g1)` yields
// two cards — the g1 group `[A, C]` at index 0 and `B` at index 1.
// The card order returned here is the DOM order StackView renders, so
// scroll-spy / active-item logic MUST iterate THIS, not the original
// flat result list (a member that maps back to an earlier card would
// otherwise corrupt the active-item computation — Codex review on
// #1504).

export interface StackDisplayItem<T> {
  /** Stable v-for key: `group:<key>` for groups, the uuid otherwise. */
  key: string;
  /** Latest member — header + single-result View props derive from it. */
  head: T;
  /** All results in this card, in arrival order (1 for singletons). */
  members: T[];
  /** True when this card merges a multi-call group. */
  isGroup: boolean;
}

export function buildStackDisplayItems<T>(
  results: readonly T[],
  groupKeyOf: (result: T) => string | null,
  uuidOf: (result: T) => string,
): StackDisplayItem<T>[] {
  const items: StackDisplayItem<T>[] = [];
  const indexByGroupKey = new Map<string, number>();
  for (const result of results) {
    const groupKey = groupKeyOf(result);
    if (groupKey !== null) {
      const existing = indexByGroupKey.get(groupKey);
      if (existing !== undefined) {
        items[existing].members.push(result);
        items[existing].head = result; // latest call drives the header
        continue;
      }
      indexByGroupKey.set(groupKey, items.length);
      items.push({ key: `group:${groupKey}`, head: result, members: [result], isGroup: true });
    } else {
      items.push({ key: uuidOf(result), head: result, members: [result], isGroup: false });
    }
  }
  return items;
}
