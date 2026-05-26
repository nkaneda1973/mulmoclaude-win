// E2E regression for session-wide map grouping in StackView (#1227 /
// Codex review on #1504).
//
// Two `mapControl` results that share a `groupId` collapse into ONE
// stack card (the View accumulates markers / routes). Grouping is
// session-wide, not contiguous: a card belonging to a DIFFERENT group
// can sit between the two same-group calls. That broke two assumptions
// in StackView's scroll code, which had treated `toolResults` order as
// 1:1 with the rendered cards:
//
//   * scroll-spy could flip the active card back to the merged group
//     when a later member's uuid resolved to the group's earlier
//     element;
//   * the latest-result watcher always slammed scrollTop to the
//     bottom, even when the newest result merged into an EARLIER card.
//
// The decision logic is unit-tested in test_stackGrouping.ts. This test
// guards the real Vue watcher / DOM wiring (nextTick + scrollIntoView +
// scroll-suppression) for the latest-result auto-scroll path.
//
// Setup: the session is PRELOADED (transcript fetch) with A(g1) and
// B(g2) already present, so on open StackView renders two map cards.
// Then a single live `mapControl` result C(g1) is streamed AFTER the
// load settles (a `startDelayMs` avoids racing the transcript fetch,
// which would otherwise overwrite live events). C's arrival fires the
// `latestResultScrollKey` watcher with the newest result belonging to
// the EARLIER g1 card — the exact non-contiguous shape that regressed.
//
// We assert C merges into the g1 card (still two cards, not three) and
// that the watcher brings that earlier card into view rather than
// slamming scrollTop to the bottom. All injected results are
// `mapControl` because text-response tool results are folded into the
// assistant text stream rather than rendered as their own card.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAgentWithPubSub, waitForScrollHeightStable, scrollMetrics } from "../fixtures/pubsub";
import { SESSION_A } from "../fixtures/sessions";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

// With no Google Maps API key configured (the default e2e mock), the
// map View renders this placeholder — measurable height, no network.
const MAP_PLACEHOLDER = "API key not configured";
// A tall assistant turn between the g1 and g2 map cards forces the
// stack to overflow AND separates the two cards by more than a
// viewport — so "scrolled to the g1 card" (top) and "bottom-pinned"
// (g2 in view, g1 off the top) are unambiguously different positions.
const TALL_TEXT = "An assistant turn long enough to push the two map cards more than a viewport apart. ".repeat(80);

function mapData(action: string, groupId: string) {
  return { action, location: "Tokyo", groupId };
}

function mapEntry(uuid: string, action: string, groupId: string) {
  return {
    type: "tool_result",
    source: "tool",
    result: { toolName: "mapControl", uuid, message: `Map operation ${action}`, data: mapData(action, groupId) },
  };
}

// Preloaded transcript: user text, A(g1), a tall assistant turn, then
// B(g2). C(g1) arrives later as a live event and must merge into the
// (now well above the fold) g1 card.
const TRANSCRIPT_ENTRIES = [
  { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
  { type: "text", source: "user", message: "Plan my Tokyo trip on the map" },
  mapEntry("map-a", "showLocation", "trip-g1"),
  { type: "text", source: "assistant", message: TALL_TEXT },
  mapEntry("map-b", "showLocation", "other-g2"),
];

// The live event: a new g1 marker that must merge into the (earlier)
// g1 card, NOT create a third card or bottom-scroll.
const LIVE_C_EVENT = {
  type: "tool_result",
  result: { toolName: "mapControl", uuid: "map-c", message: "Map operation addMarker", data: mapData("addMarker", "trip-g1") },
};

// The transcript fetch is a near-instant local mock; this delay only
// has to outlast it so C appends to the loaded session rather than
// racing the load.
const STREAM_AFTER_LOAD_MS = 1200;

async function openSessionInStackMode(page: Page): Promise<void> {
  // Serve the custom transcript for this session; fall back to the
  // default mock for any other session id.
  await page.route(
    (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ json: TRANSCRIPT_ENTRIES });
    },
  );
  // Stack layout is a localStorage preference; set it before navigating
  // so the first render is already in stack mode. The default viewport
  // gives the stack container a normal height; the tall transcript turn
  // is what forces the overflow.
  await page.addInitScript(() => localStorage.setItem("canvas_layout_mode", "stack"));
  await page.goto(`/chat/${SESSION_A.id}`);
}

test.describe("StackView — session-wide map grouping (#1227)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    // Defensive: never hit the real Maps JS even if a key leaks in.
    await page.route(/maps\.googleapis\.com/, (route) => route.abort());
  });

  test("a newly streamed same-groupId map result merges into its (earlier) card and scrolls there, not to the bottom", async ({ page }) => {
    await mockAgentWithPubSub(page, [LIVE_C_EVENT], { startDelayMs: STREAM_AFTER_LOAD_MS });
    await openSessionInStackMode(page);

    // Preloaded state: two map cards (g1 = A, g2 = B).
    await expect(page.getByText(MAP_PLACEHOLDER).first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.getByText(MAP_PLACEHOLDER)).toHaveCount(2);

    // C(g1) streams in after the load. It must merge into the existing
    // g1 card — still exactly two map cards, never three.
    await page.waitForTimeout(STREAM_AFTER_LOAD_MS);
    await waitForScrollHeightStable(page, "stack-scroll");
    await expect(page.getByText(MAP_PLACEHOLDER)).toHaveCount(2);

    // Latest-result wiring: C is the newest result but its card is the
    // FIRST (g1) card, not the last. The fixed watcher brings that card
    // into view; the regression slammed scrollTop to the bottom, which
    // would push the g1 card off the top of the viewport.
    await expect(page.getByText(MAP_PLACEHOLDER).first()).toBeInViewport();

    const { scrollTop, scrollHeight, clientHeight } = await scrollMetrics(page, "stack-scroll");
    expect(scrollHeight).toBeGreaterThan(clientHeight); // container actually overflows
    const distanceFromBottomPx = scrollHeight - scrollTop - clientHeight;
    const BOTTOM_TOLERANCE_PX = 50;
    expect(distanceFromBottomPx).toBeGreaterThan(BOTTOM_TOLERANCE_PX); // NOT bottom-pinned
  });
});
