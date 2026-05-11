import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { isRecord } from "../../server/utils/types.ts";
import {
  MCP_MANAGE_SKILLS_TOOL_NAME,
  type ToolCallTraceRecord,
  deleteSession,
  getCurrentSessionId,
  placeProjectSkill,
  readProjectSkillBody,
  readSessionToolCalls,
  removeProjectSkill,
  selectRole,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";

const L21_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L22_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L31_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

// Centralise "did this tool_call create a skill via the manageSkills
// MCP bridge?" for L-31. The predicate has two coupled checks
// (toolName and args.action="save"); without this helper a future
// save-action rename in the bridge would only get caught at one
// callsite.
function isManageSkillsSaveCall(call: ToolCallTraceRecord): boolean {
  if (call.toolName !== MCP_MANAGE_SKILLS_TOOL_NAME) return false;
  if (!isRecord(call.args)) return false;
  return call.args.action === "save";
}

// All three scenarios talk to the live LLM (L-21: chart tool
// dispatch, L-22: skill execution, L-31: manageSkills MCP bridge
// canary). They share no state — run in parallel to cut wall
// time, mirroring the other category specs.
test.describe.configure({ mode: "parallel" });

test.describe("skills (real LLM / static)", () => {
  test("L-21: Office role + presentChart で deferred-tool dispatch が成功し chart-canvas が描画される", async ({ page }) => {
    test.setTimeout(L21_TIMEOUT_MS);
    // Covers B-41: Claude CLI auto-flips into deferred-tools mode
    // when the registered tool count crosses its threshold (~18+),
    // and a regression in that path historically broke first-turn
    // tool dispatch across every role. L-03 already exercises this
    // through presentMulmoScript on the General role; L-21 is a
    // second canary on a different role/tool combination so a
    // regression that shears just one branch (e.g. `presentChart`
    // schema mis-published in deferred mode) is caught even when
    // the L-03 path keeps working. The chart plugin renders
    // quickly, has no external API dependency, and exposes a
    // stable `chart-card-0` / `chart-canvas-0` testid
    // (`src/plugins/chart/View.vue`).
    //
    // Why Office: General's `availablePlugins` (`src/config/roles.ts`)
    // does NOT include `presentChart` — Office, Tutor, Spreadsheet,
    // and Accounting do. The first iteration on this spec hit
    // exactly that: the LLM replied "I can't find a presentChart
    // tool" because the role gate hid it. Switching to Office
    // here keeps the canary on a role/tool pair where dispatch is
    // genuinely available.
    //
    // Prompt names the exact tool and forbids the alternatives so
    // the LLM does not wander to presentHtml or textResponse.
    const userPrompt = [
      "Use the `presentChart` tool to render a bar chart titled 'L-21 sales' with data Jan 100, Feb 150, Mar 120.",
      "Do not use presentHtml. Do not use any other tool. Do not narrate the result in text.",
    ].join(" ");
    const sessionsToCleanup: string[] = [];
    try {
      // selectRole spawns a fresh /chat/<id> in the new role on
      // chat pages (App.vue's onRoleChange). Mirroring the
      // roles.spec.ts cleanup pattern: capture both the auto-
      // created General session id and the role-switched Office
      // session id so neither leaks into history.
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "office");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const officeSessionId = getCurrentSessionId(page);
      if (officeSessionId !== null && officeSessionId !== generalSessionId) {
        sessionsToCleanup.push(officeSessionId);
      }
      await expect(page.getByTestId("role-selector-btn"), "role chip must reflect office after switch").toHaveAttribute("data-role", "office");
      await sendChatMessage(page, userPrompt);
      // The chart tool result mounts ChartView, which renders one
      // `[data-testid="chart-card-${idx}"]` per chart spec. The
      // first card is enough — extra cards (rare LLM-authored
      // multi-chart payloads) do not invalidate the dispatch
      // signal. `chart-canvas-0` going visible proves both the
      // tool round-trip and the v-for hydration; an upstream
      // failure in deferred-tools mode would land us in a
      // textResponse view instead, with no chart-* testid in DOM.
      await expect(page.getByTestId("chart-card-0"), "chart card must mount after the tool call (B-41 canary)").toBeVisible({ timeout: 2 * ONE_MINUTE_MS });
      await expect(page.getByTestId("chart-canvas-0"), "chart canvas must hydrate (deferred-tool dispatch reached the view)").toBeVisible();

      await waitForAssistantResponseComplete(page);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
    }
  });

  test("L-22: 合成 skill を seed → Run → agent が skill body 通りに応答する (B-08 end-to-end)", async ({ page }, testInfo) => {
    test.setTimeout(L22_TIMEOUT_MS);
    // Covers B-08 end-to-end: a skill on disk has to (a) surface in
    // `/skills`, (b) load its body into the detail pane, AND (c)
    // be picked up by the Claude SDK when invoked as `/<slug>`. The
    // earlier draft of this spec stopped at (a)+(b) on the theory
    // that the dangling failure mode trips before (c) — true for
    // Docker dangling (real B-08), but in non-Docker mode (a)+(b)
    // are a happy-path smoke test only. Pressing Run lifts the
    // canary into a true end-to-end check: the skill row visible
    // proves nothing if the body never reaches the agent.
    //
    // Synthetic skill body: we instruct the agent to reply with a
    // unique marker (`L22-OK-<nonce>`). The marker has to be in the
    // assistant transcript for the test to pass — that means
    //   discovery → /api/skills list ✓
    //   /api/skills/:name detail ✓
    //   slash-command dispatch into agent ✓
    //   skill body actually conditioning the response ✓
    // all four had to work. A regression at any layer (Docker
    // dangling, `/<slug>` not registered, body not piped to the
    // agent prompt, etc.) collapses one of those into a fail with
    // a localised diagnostic.
    //
    // Picking a marker rather than a freeform reply keeps the
    // assertion deterministic: LLMs occasionally embellish ("Sure!
    // L22-OK-XYZ"), so we use `toContainText` which tolerates the
    // surrounding prose while still failing on a missing marker.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    // Slug must satisfy isValidSlug (lowercase / digit / hyphen).
    // randomUUID() is hex+hyphen, so the slice survives the rule.
    const skillSlug = `e2e-live-l22-${projectSlug}-${nonce}`;
    const description = `L-22 canary skill ${nonce}`;
    // Marker shape: ASCII-only, distinctive prefix, embedded nonce.
    // Lives both in the SKILL.md body (so the rendered detail can
    // be sanity-checked) and in the expected assistant reply (so
    // the run leg is verified). One string, two assertion sites.
    const replyMarker = `L22-OK-${nonce}`;
    const body = [
      "## L-22 canary skill",
      "",
      "Synthetic skill seeded by e2e-live for end-to-end verification.",
      "",
      `When invoked via the slash command, respond with this exact line and nothing else: ${replyMarker}`,
    ].join("\n");
    let sessionIdForCleanup: string | null = null;
    try {
      await placeProjectSkill(skillSlug, description, body);
      await page.goto("/skills");

      // Sanity layer (a)+(b): the row is keyed by the seeded slug.
      // If the workspace's `.claude/skills/` were unreadable
      // (dangling symlink, permission error, server cache miss),
      // the seeded file would not surface and the row would never
      // appear.
      const skillRow = page.getByTestId(`skill-item-${skillSlug}`);
      await expect(skillRow, "seeded project skill must appear in /skills list").toBeVisible({ timeout: ONE_MINUTE_MS });
      await skillRow.click();
      const bodyView = page.getByTestId("skill-body-rendered");
      await expect(bodyView, "detail body must hydrate (proves SKILL.md is readable)").toBeVisible({ timeout: ONE_MINUTE_MS });
      await expect(bodyView, "rendered body must echo the seeded marker").toContainText(replyMarker);

      // Layer (c): Run = `appApi.startNewChat('/<slug>')` — the
      // SPA navigates to /chat/<id> and the agent receives the
      // slash command as its first turn. Capture the new session
      // id immediately after the URL settles so cleanup runs even
      // if the assistant turn below times out.
      await page.getByTestId("skill-run-btn").click();
      await page.waitForURL(SESSION_URL_PATTERN);
      sessionIdForCleanup = getCurrentSessionId(page);

      await waitForAssistantResponseComplete(page, 2 * ONE_MINUTE_MS);

      // The assistant body must contain the marker. Anchor the
      // assertion to `text-response-assistant-body` so user-typed
      // bubbles, sidebar history previews, and the tool call
      // history pane are excluded by construction (`.last()` keeps
      // the locator strict-mode-safe in stack layout). If this
      // line fails, the chain broke in layer (c): the row + body
      // were fine but the slash-command path did not actually load
      // the skill into the agent's context.
      await expect(
        page.getByTestId("text-response-assistant-body").last(),
        "assistant must echo the marker — proves skill body reached the agent",
      ).toContainText(replyMarker, {
        timeout: 2 * ONE_MINUTE_MS,
      });
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
      await removeProjectSkill(skillSlug);
    }
  });

  test("L-31: 「manageSkills tool で skill を作って」 と明示すると Claude が manageSkills MCP bridge を呼ぶ (Tutor, plumbing canary)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(L31_TIMEOUT_MS);
    // Plumbing canary for the `manageSkills` MCP bridge — does the
    // tool itself still dispatch end-to-end when the prompt names
    // it explicitly and the role surfaces it? After commit
    // `0fb0f8e0` (2026-04-29, split workspace-management plugins
    // into a Settings role) and PR #1284 (replaced the Settings
    // role with the `mc-settings` preset skill), `Tutor` is the
    // remaining role whose `availablePlugins` (`src/config/roles.ts`)
    // surfaces `manageSkills`. This canary stays on Tutor for now
    // so a manageSkills bridge regression is caught in isolation;
    // a follow-up issue tracks restoring `manageSkills` to General
    // (where the user-facing surface lives), and once that lands
    // this spec should switch to General.
    //
    // Verification leans on `tool_call` records persisted by
    // `server/workspace/tool-trace`, not on the user-visible UI:
    // outcome alone (`SKILL.md` on disk) cannot tell whether
    // manageSkills was the path taken — a direct `Write` would
    // produce the same on-disk artifact. The trace records which
    // tool the SDK dispatched, so the assertion is pinned to actual
    // behaviour rather than to side effects.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const skillSlug = `e2e-live-l31-${projectSlug}-${nonce}`;
    const description = `L-31 canary skill ${nonce}`;
    const replyMarker = `L31-OK-${nonce}`;
    const skillBody = `When invoked, reply with the marker ${replyMarker} and nothing else.`;
    // Prompt is deliberately operational — "use the manageSkills
    // tool, action save, here are the fields" — so a passing run
    // proves the dispatch path works end-to-end without depending
    // on the LLM creatively interpreting which tool to grab.
    const prompt = [
      'Use the `manageSkills` tool with action: "save" to create a project skill.',
      `name: ${skillSlug}`,
      `description: ${description}`,
      `body: ${skillBody}`,
      "Do not use the Write tool. Do not narrate the result.",
    ].join("\n");
    // `manageSkills` lives in `availablePlugins` for the Tutor
    // role only after PR #1284 (`src/config/roles.ts`). General —
    // the role `startNewSession` lands on by default — does not
    // surface the tool to the agent at all, so a "Use manageSkills"
    // prompt sent there gets a Write/Bash fallback even when the
    // bridge itself is healthy. We switch to Tutor up front so this
    // canary is testing dispatch-path health, not role-config
    // drift; if a future role re-shuffle moves manageSkills, the
    // test will fail here and the on-call has a single greppable
    // spot to retarget.
    const sessionsToCleanup: string[] = [];
    try {
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "tutor");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const tutorSessionId = getCurrentSessionId(page);
      if (tutorSessionId === null) {
        throw new Error("getCurrentSessionId returned null after role switch to tutor");
      }
      if (tutorSessionId !== generalSessionId) sessionsToCleanup.push(tutorSessionId);
      await sendChatMessage(page, prompt);
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      // Primary assertion: at least one save-action manageSkills call
      // landed in the session jsonl. `args.action === "save"` is the
      // discriminator — list / update / delete share the same toolName
      // so the predicate has to look at args too.
      const toolCalls = await readSessionToolCalls(tutorSessionId);
      const saveCalls = toolCalls.filter(isManageSkillsSaveCall);
      expect(saveCalls.length, "manageSkills(action=save) must dispatch at least once when explicitly named in the prompt").toBeGreaterThan(0);

      // Outcome sanity: the save call wrote SKILL.md on disk with the
      // body we asked for. Catches a pathological regression where
      // the bridge accepts the call but the POST /api/skills handler
      // silently drops the body — the trace would still show the
      // call but nothing would land.
      const onDiskBody = await readProjectSkillBody(skillSlug);
      expect(onDiskBody, "manageSkills save must materialise SKILL.md on disk").not.toBeNull();
      expect(onDiskBody, "SKILL.md must contain the body we asked for").toContain(replyMarker);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
      await removeProjectSkill(skillSlug);
    }
  });
});
