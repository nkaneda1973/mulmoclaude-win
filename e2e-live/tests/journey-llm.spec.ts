import { randomUUID } from "node:crypto";

import { type Locator, type Page, type Response, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { isRecord } from "../../server/utils/types.ts";
import { deleteSession, placeWorkspaceFile, readWorkspaceFile, sendChatMessage, setupRoleSession, waitForAssistantTurn } from "../fixtures/live-chat.ts";

// L-JOURNEY-* — "the feature actually works end-to-end via the real
// LLM" net (plans/feat-e2e-live.md §「最優先方針 (2026-05-30)」). Two
// existing layers leave a gap this file closes:
//
//   - plugin-dispatch.spec.ts (L-DISPATCH-*) proves the agent
//     dispatched a manage* tool, but asserts ONLY on the per-session
//     jsonl trace + the workspace DB file. Its own header notes it
//     deliberately skips a View-mount assertion ("adding View testids
//     per plugin is a separate refactor").
//   - journey-todo.spec.ts (L-JOURNEY-TODO) drives a feature through
//     its UI add button — but a pure UI click → REST → reload journey
//     is reproducible under mock e2e, so it does not exercise the
//     real LLM path that is the whole reason e2e-live exists.
//
// These three journeys are the missing middle: drive the *add* from
// chat (real LLM tool dispatch) and then assert the mutation is
// REFLECTED IN THE VIEW the user looks at, then run an
// add↔delete (or add→persist→delete) lifecycle. The marker only
// appears in the View if the LLM dispatch landed AND the View
// rendered it, so the View assertion subsumes the dispatch check.
//
// Per the 2026-05-30 design principle: add is always LLM-driven
// (calendar / todo / accounting expose a role-gated manage* tool);
// deletes mix UI (calendar) and LLM (todo / accounting) so the suite
// canaries both teardown paths.
//
// Skip on E2E_LIVE_NO_LLM=1 — the fake-echo backend cannot route MCP
// tool calls, so no add would ever land. Each test owns a fresh
// session + a per-test nonce-stamped marker, so the three run in
// parallel without colliding (each touches a different workspace DB).
test.describe.configure({ mode: "parallel" });

// Roomy per-test budget: each journey runs two real LLM turns
// (add + delete) plus a View navigation, so the ceiling matches the
// 5-minute window plugin-dispatch.spec.ts settles on for its
// two-turn cases.
const JOURNEY_TIMEOUT_MS = 5 * ONE_MINUTE_MS;
// How long to wait for a View to reflect an LLM mutation after the
// agent turn ends. The file write is already flushed (waitForAssistantTurn
// gates on the turn ending), so this only covers the SPA's on-mount /
// poll fetch + render — 30s gives slow CI workers headroom without
// masking a real "never rendered" regression.
const VIEW_REFLECT_TIMEOUT_MS = 30 * ONE_SECOND_MS;
// Cap on a todo-plugin runtime dispatch (checkbox toggle) flushing to
// disk before the reload, mirroring journey-todo.spec.ts.
const TODO_DISPATCH_FLUSH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// `useTodos` routes every mutation through the host's
// POST /api/plugins/runtime/<pkg>/dispatch; anchor the flush gate on
// this fragment pair so unrelated SSE / metrics traffic is ignored.
const RUNTIME_DISPATCH_URL_FRAGMENT = "/api/plugins/runtime/";
const TODO_PLUGIN_SLUG_FRAGMENT = "todo-plugin";

// Workspace DB files (mirrors plugin-dispatch.spec.ts). Used both by
// the accounting delete-confirmation (config.json is the source of
// truth the inline View hydrates from — it collapses once a newer
// turn lands) AND by the finally-block best-effort cleanup that prunes
// a leaked marker row if a test threw before its delete leg.
const ACCOUNTING_CONFIG_REL = "data/accounting/config.json";
const CALENDAR_DB_REL = "data/scheduler/items.json";
const TODO_DB_REL = "data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json";

// Per-test unique marker (epoch ms + 6 hex). Mirrors
// plugin-dispatch.spec.ts so a stray artifact left by a failed run is
// unambiguously attributable to this test, and parallel runs / a
// concurrent plugin-dispatch spec never collide on the shared DB.
function makeMarker(testId: string): string {
  return `${testId}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

test.describe("L-JOURNEY-* (real LLM add → View reflection → lifecycle)", () => {
  test.skip(process.env.E2E_LIVE_NO_LLM === "1", "fake-echo backend cannot route MCP tool calls — no add would land");

  test("L-JOURNEY-CAL: chat で予定を add → /calendar に反映 → UI から delete", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-CAL");
    const sessions: string[] = [];
    try {
      await setupRoleSession(page, "personal", sessions);
      await sendChatMessage(page, calendarAddPrompt(marker));
      await waitForAssistantTurn(page);

      await openCalendarList(page);
      const event = calendarEventByMarker(page, marker);
      await expect(event, "the LLM-added event must reflect in the calendar list view").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });

      await deleteCalendarEventViaUi(page, event);
      await expect(calendarEventByMarker(page, marker), "the UI delete must remove the event from the list").toHaveCount(0, {
        timeout: VIEW_REFLECT_TIMEOUT_MS,
      });
    } finally {
      await bestEffortPruneMarkerRow(CALENDAR_DB_REL, undefined, "title", marker);
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-TODO-LLM: chat で todo を add → /todos に反映 → check が reload で残る → chat で delete", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-TODO-LLM");
    const sessions: string[] = [];
    try {
      const sessionId = await setupRoleSession(page, "personal", sessions);
      await sendChatMessage(page, todoAddPrompt(marker));
      await waitForAssistantTurn(page);

      await assertTodoCardReflectedAndPersisted(page, marker);
      await deleteTodoFromChat(page, sessionId, marker);

      await openTodos(page);
      await expect(todoCardByMarker(page, marker), "the LLM delete must remove the card from /todos").toHaveCount(0, {
        timeout: VIEW_REFLECT_TIMEOUT_MS,
      });
    } finally {
      await bestEffortPruneMarkerRow(TODO_DB_REL, undefined, "text", marker);
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-ACCT: chat で帳簿を作成して開く → switcher に反映 → chat で delete → DB から消える", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-ACCT");
    const sessions: string[] = [];
    try {
      await setupRoleSession(page, "accounting", sessions);
      await sendChatMessage(page, accountingCreatePrompt(marker));
      await waitForAssistantTurn(page);

      // Headline: the LLM-created book is reflected in the live View's
      // switcher. The accounting plugin has no standalone route — the
      // view only mounts via the openBook envelope inline in chat.
      const app = page.getByTestId("accounting-app").last();
      await expect(app, "openBook must mount the accounting view inline in the chat").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
      // The book-select is a native <select> bound to activeBookId, so
      // the SELECTED option (`option:checked`) is the active book —
      // assert against that, not the whole select (whose text contains
      // every book's option and would false-green if another book were
      // active). Codex iter-1 must-fix.
      await expect(
        app.getByTestId("accounting-book-select").locator("option:checked"),
        "the LLM-created book must be the ACTIVE book in the switcher",
      ).toContainText(marker, { timeout: VIEW_REFLECT_TIMEOUT_MS });

      // Delete is a second LLM turn. That collapses the openBook
      // envelope above (inline plugin views render expanded only while
      // they are the latest turn), so the View's deleted-notice can't
      // be observed in place — confirm the lifecycle on the workspace
      // DB the View hydrates from instead (deterministic, read-only).
      await sendChatMessage(page, accountingDeletePrompt(marker));
      await waitForAssistantTurn(page);
      await assertBookDeletedFromDb(marker);
    } finally {
      await bestEffortPruneMarkerRow(ACCOUNTING_CONFIG_REL, "books", "name", marker);
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });
});

// ---------------------------------------------------------------------------
// calendar (manageCalendar — Personal role)
// ---------------------------------------------------------------------------

function calendarAddPrompt(marker: string): string {
  return [
    `Use the \`manageCalendar\` tool with action='add' to add a calendar event whose title is EXACTLY '${marker}' (verbatim) on 2099-12-31.`,
    "Do not use show / update / any other action. Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

// List view (not month) so a far-future event is in scope: the list
// renders every item regardless of date, whereas month/week only show
// the visible period.
async function openCalendarList(page: Page): Promise<void> {
  await page.goto("/calendar");
  await expect(page.getByTestId("scheduler-view-root"), "/calendar must mount the scheduler view").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
  await page.getByTestId("scheduler-view-mode-list").click();
}

function calendarEventByMarker(page: Page, marker: string): Locator {
  return page.getByTestId("scheduler-event-item").filter({ hasText: marker });
}

async function deleteCalendarEventViaUi(page: Page, event: Locator): Promise<void> {
  // The per-row delete (✕) button reveals on hover (opacity-0 →
  // group-hover) and fires a window.confirm before it dispatches the
  // delete. Install the dialog acceptor BEFORE the click — confirm()
  // resolves synchronously, so a late listener misses the prompt and
  // hangs the click.
  page.once("dialog", (dialog) => {
    dialog.accept().catch(() => undefined);
  });
  await event.hover();
  await event.locator('[data-testid^="scheduler-item-delete-"]').click();
}

// ---------------------------------------------------------------------------
// todo (manageTodoList — Personal role, runtime plugin)
// ---------------------------------------------------------------------------

function todoAddPrompt(marker: string): string {
  return [
    `Use the \`manageTodoList\` tool with action='add' to add one todo whose text is EXACTLY '${marker}' (verbatim, no edits).`,
    "Do not use show / any other action. Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

function todoDeletePrompt(marker: string): string {
  return [
    `Now delete every todo whose text equals EXACTLY '${marker}'.`,
    "Use the manageTodoList tool with action='delete' (look it up via ToolSearch if needed). Do not narrate the result.",
  ].join(" ");
}

async function openTodos(page: Page): Promise<void> {
  await page.goto("/todos");
  await expect(page.getByTestId("todo-view-root"), "/todos must mount").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
}

function todoCardByMarker(page: Page, marker: string): Locator {
  return page.locator('[data-testid^="todo-card-"]').filter({ hasText: marker }).first();
}

// Open /todos, prove the LLM-added card rendered, tick its checkbox,
// wait for the runtime dispatch to flush, then reload and assert both
// the card and its checked state survived — the round trip through
// the todo-plugin REST + workspace JSON the View hydrates from.
async function assertTodoCardReflectedAndPersisted(page: Page, marker: string): Promise<void> {
  await openTodos(page);
  const card = todoCardByMarker(page, marker);
  await expect(card, "the LLM-added todo must reflect as a kanban card").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });

  const checkbox = card.locator('input[type="checkbox"]').first();
  const flushed = waitForTodoDispatch(page);
  await checkbox.check();
  await flushed;
  await expect(checkbox, "the checked state flips immediately").toBeChecked();

  await page.reload();
  await expect(page.getByTestId("todo-view-root")).toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
  const cardAfter = todoCardByMarker(page, marker);
  await expect(cardAfter, "the todo persists across reload").toBeVisible();
  await expect(cardAfter.locator('input[type="checkbox"]').first(), "the checked state persists across reload").toBeChecked();
}

function waitForTodoDispatch(page: Page): Promise<Response> {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes(RUNTIME_DISPATCH_URL_FRAGMENT) && resp.url().includes(TODO_PLUGIN_SLUG_FRAGMENT) && resp.request().method() === "POST" && resp.ok(),
    { timeout: TODO_DISPATCH_FLUSH_TIMEOUT_MS },
  );
}

// Re-enter the chat session (the View navigation detached it) and ask
// the agent to delete the marker — a second real LLM turn so the
// todo journey canaries the delete dispatch path too, not just add.
async function deleteTodoFromChat(page: Page, sessionId: string, marker: string): Promise<void> {
  await page.goto(`/chat/${sessionId}`);
  await sendChatMessage(page, todoDeletePrompt(marker));
  await waitForAssistantTurn(page);
}

// ---------------------------------------------------------------------------
// accounting (manageAccounting — Accounting role)
// ---------------------------------------------------------------------------

function accountingCreatePrompt(marker: string): string {
  return [
    `Use the \`manageAccounting\` tool with action='createBook' to create a book whose name is EXACTLY '${marker}' (verbatim), currency='USD', country='US'.`,
    "Then call the same tool with action='openBook' for that book so its view mounts in the chat.",
    "Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

function accountingDeletePrompt(marker: string): string {
  return [
    `Now delete the book whose name equals EXACTLY '${marker}'.`,
    "Use the manageAccounting tool with action='getBooks' to find its bookId, then action='deleteBook' with confirm=true. Do not narrate the result.",
  ].join(" ");
}

// Poll the accounting DB until the marker book is gone — the server
// write can lag the assistant turn ending by a beat. Read-only, so it
// never races a concurrent write (other specs use distinct book names).
async function assertBookDeletedFromDb(marker: string): Promise<void> {
  await expect(async () => {
    const raw = await readWorkspaceFile(ACCOUNTING_CONFIG_REL);
    // File gone entirely is the strongest form of "book absent".
    if (raw === null) return;
    // Fail CLOSED on corrupt / schema-drifted JSON (Codex iter-1
    // must-fix): a parse / shape failure throws, which inside `toPass`
    // keeps retrying (tolerating a transient mid-write read) and then
    // fails at the timeout rather than silently passing the delete
    // check on a broken DB.
    const names = parseBookNamesStrict(raw);
    expect(names, `book '${marker}' must be gone from ${ACCOUNTING_CONFIG_REL} after the LLM deleteBook turn`).not.toContain(marker);
  }).toPass({ timeout: VIEW_REFLECT_TIMEOUT_MS });
}

function parseBookNamesStrict(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${ACCOUNTING_CONFIG_REL} is not valid JSON after deleteBook (corrupt DB): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) {
    throw new Error(`${ACCOUNTING_CONFIG_REL} did not have the expected { books: [...] } shape after deleteBook`);
  }
  return parsed.books.filter(isRecord).map((book) => (typeof book.name === "string" ? book.name : ""));
}

// ---------------------------------------------------------------------------
// shared cleanup
// ---------------------------------------------------------------------------

// Best-effort teardown for the row a test created, run from `finally`
// so an early failure (before the in-`try` delete leg) cannot leak a
// marker row into a shared workspace DB (Codex iter-1 must-fix). It is
// existence-GATED: it reads first and only writes when the marker row
// is still present, so the happy path (lifecycle delete already
// removed it) performs zero writes and cannot clobber a concurrent
// spec's write — the only write happens on the rare early-failure
// path, scoped to removing this test's own nonce-stamped row. Never
// throws: a cleanup hiccup must not turn a passing test red.
async function bestEffortPruneMarkerRow(workspaceRel: string, arrayPath: string | undefined, matchField: string, marker: string): Promise<void> {
  try {
    const raw = await readWorkspaceFile(workspaceRel);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    const rows = extractRows(parsed, arrayPath);
    if (rows === null || !rows.some((row) => isRecord(row) && row[matchField] === marker)) return;
    const kept = rows.filter((row) => !(isRecord(row) && row[matchField] === marker));
    await placeWorkspaceFile(workspaceRel, JSON.stringify(reassembleRows(parsed, arrayPath, kept), null, 2));
  } catch (err) {
    console.warn(`bestEffortPruneMarkerRow: cleanup skipped for ${workspaceRel}`, err);
  }
}

function extractRows(parsed: unknown, arrayPath: string | undefined): unknown[] | null {
  if (arrayPath === undefined) return Array.isArray(parsed) ? parsed : null;
  if (!isRecord(parsed)) return null;
  return Array.isArray(parsed[arrayPath]) ? parsed[arrayPath] : null;
}

function reassembleRows(parsed: unknown, arrayPath: string | undefined, kept: unknown[]): unknown {
  if (arrayPath === undefined) return kept;
  return isRecord(parsed) ? { ...parsed, [arrayPath]: kept } : { [arrayPath]: kept };
}
