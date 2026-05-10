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
  snapshotProjectSkillSlugs,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";

const L21_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L22_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L31_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L32_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

// `Write` is the built-in editor tool the SDK exposes by name (no MCP
// prefix). We assert its absence on `.claude/skills/` paths because
// that is the regression shape behind this canary: Claude reaching
// straight for the filesystem editor instead of the manageSkills MCP
// bridge gets blocked by the harness's sensitive-path guard, and the
// user observes a stuck conversation. Naming the tool here keeps the
// "must not Write to skills dir" predicate one place.
const BUILTIN_WRITE_TOOL_NAME = "Write";
const PROJECT_SKILLS_PATH_FRAGMENT = "/.claude/skills/";

// Centralise "did this tool_call create a skill via the MCP bridge?"
// because L-31 (explicit prompt) and L-32 (ambiguous prompt) both
// need it, and the predicate has two coupled checks (toolName and
// args.action="save"). Without this helper the two specs would drift
// — codex iter-style — and a save-action rename in the bridge would
// only get caught at one site.
function isManageSkillsSaveCall(call: ToolCallTraceRecord): boolean {
  if (call.toolName !== MCP_MANAGE_SKILLS_TOOL_NAME) return false;
  if (!isRecord(call.args)) return false;
  return call.args.action === "save";
}

// Mirror predicate for the regression we are guarding against:
// `Write` invoked with a `file_path` somewhere under
// `.claude/skills/`. We intentionally match on substring rather than
// a full prefix because the path could be absolute (host workspace)
// or relative (cwd-anchored) depending on how the SDK normalises
// args; the `/.claude/skills/` segment is unambiguous either way.
function isWriteToProjectSkillsCall(call: ToolCallTraceRecord): boolean {
  if (call.toolName !== BUILTIN_WRITE_TOOL_NAME) return false;
  if (!isRecord(call.args)) return false;
  const filePath = call.args.file_path;
  return typeof filePath === "string" && filePath.includes(PROJECT_SKILLS_PATH_FRAGMENT);
}

// Both scenarios talk to the live LLM (L-21: chart tool dispatch,
// L-22: skill execution). They share no state — run in parallel
// to cut wall time, mirroring the other category specs.
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

  test("L-31: 「manageSkills tool で skill を作って」 と明示すると Claude が manageSkills を呼ぶ (canary)", async ({ page }, testInfo) => {
    test.setTimeout(L31_TIMEOUT_MS);
    // Canary for the bridge plumbing itself. The prompt names the
    // tool by hand (`manageSkills`) and pins the slug, so a regression
    // here points at the MCP server / route side rather than at
    // Claude's tool-selection heuristics. L-32 is the corresponding
    // ambiguous-prompt canary; reading the two together separates
    // "Claude does not pick manageSkills" from "manageSkills is
    // broken". Without L-31 a fail in L-32 looks the same in either
    // case and the on-call is left guessing.
    //
    // Verification leans on `tool_call` records persisted by
    // `server/workspace/tool-trace`, not on the user-visible UI:
    // outcome alone (`SKILL.md` on disk) cannot tell whether
    // manageSkills was the path taken — the f65b1da1 incident
    // landed the file via a `Write` → permission-denied → manual
    // `mv` workaround that B-style outcome checks would silently
    // pass. The trace records which tool the SDK dispatched, so the
    // assertion is pinned to actual behaviour rather than to side
    // effects that any number of paths can produce.
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
    // `manageSkills` lives in `availablePlugins` for the Settings
    // role only (`src/config/roles.ts`). General — the role
    // `startNewSession` lands on by default — does not surface the
    // tool to the agent at all, so a "Use manageSkills" prompt sent
    // there gets a Write/Bash fallback even when the bridge itself
    // is healthy. We switch to Settings up front so this canary is
    // testing dispatch-path health, not role-config drift; if a
    // future role re-shuffle moves manageSkills, the test will fail
    // here and the on-call has a single greppable spot to retarget.
    const sessionsToCleanup: string[] = [];
    try {
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "settings");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const settingsSessionId = getCurrentSessionId(page);
      if (settingsSessionId === null) {
        throw new Error("getCurrentSessionId returned null after role switch to settings");
      }
      if (settingsSessionId !== generalSessionId) sessionsToCleanup.push(settingsSessionId);
      await sendChatMessage(page, prompt);
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      // Primary assertion: at least one save-action manageSkills call
      // landed in the session jsonl. `args.action === "save"` is the
      // discriminator — list / update / delete share the same toolName
      // so the predicate has to look at args too.
      const toolCalls = await readSessionToolCalls(settingsSessionId);
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

  test("L-32: 曖昧 「skill 作って」 でも Claude が manageSkills を選ぶ (Write 直行を禁止)", async ({ page }, testInfo) => {
    test.setTimeout(L32_TIMEOUT_MS);
    // The headline canary for the f65b1da1 regression: a chat user
    // says "skill を作って" without naming a tool, and Claude must
    // reach for the manageSkills MCP bridge rather than reaching
    // for the built-in `Write` editor against `.claude/skills/`.
    // The latter is sensitive-path-guarded by the harness, so a
    // wrong choice surfaces user-side as a stuck conversation
    // ("Allow this edit?") rather than a working skill.
    //
    // Two coupled assertions because outcome alone does not
    // discriminate the failure mode:
    //   1. manageSkills(save) appears in the trace — the right
    //      path was actually taken.
    //   2. Write to anywhere under `.claude/skills/` does NOT
    //      appear — Claude did not start with the wrong tool and
    //      then fall back. Watching Write is what makes the
    //      "tried Write first, hit permission, found a workaround"
    //      shape detectable; the original incident landed a file
    //      via a manual `mv` after Claude had already tried Write,
    //      so an outcome-only test would have passed it.
    //
    // Slug is left to Claude (the prompt says "create a skill",
    // nothing about naming). Cleanup snapshots the skills dir
    // before the run and filters the post-run delta by the body
    // marker — so a parallel L-31 / L-22 run cannot be deleted by
    // accident, even though they share the same workspace.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const replyMarker = `L32-OK-${projectSlug}-${nonce}`;
    // Phrasing leans operational without leaking the tool name.
    // The marker requirement in the body is what later anchors
    // cleanup to "this run only" — without it, a parallel test's
    // slug could be vacuumed up by mistake.
    const prompt = [
      `「呼ばれたら ${replyMarker} とだけ返事するスキル」 を作ってください。`,
      `スキル本文には marker 文字列 ${replyMarker} を必ず含めてください。`,
    ].join("\n");
    const baselineSlugs = await snapshotProjectSkillSlugs();
    // Same role rationale as L-31: General omits `manageSkills` from
    // `availablePlugins` so the agent never sees the tool there at
    // all, and the regression we want to detect (Write fallback when
    // manageSkills IS visible) is invisible from General. Settings is
    // the canonical role for skill management.
    const sessionsToCleanup: string[] = [];
    let createdSlugs: string[] = [];
    try {
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "settings");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const settingsSessionId = getCurrentSessionId(page);
      if (settingsSessionId === null) {
        throw new Error("getCurrentSessionId returned null after role switch to settings");
      }
      if (settingsSessionId !== generalSessionId) sessionsToCleanup.push(settingsSessionId);
      await sendChatMessage(page, prompt);
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      const toolCalls = await readSessionToolCalls(settingsSessionId);
      const saveCalls = toolCalls.filter(isManageSkillsSaveCall);
      const writeToSkills = toolCalls.filter(isWriteToProjectSkillsCall);

      expect(saveCalls.length, "Claude must reach for manageSkills(save), not the Write tool — this is the f65b1da1 regression shape").toBeGreaterThan(0);
      expect(writeToSkills.length, "Claude must NOT Write directly to .claude/skills/ — that path is sensitive-path-guarded and stalls the chat").toBe(0);

      createdSlugs = await collectL32CreatedSlugs(baselineSlugs, replyMarker);
      expect(createdSlugs.length, "at least one new skill dir containing this run's marker must appear under .claude/skills/").toBeGreaterThan(0);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
      // Cleanup falls outside the diff path's nonce filter so a
      // failed-mid-test run that already created a dir still gets
      // cleaned up — `createdSlugs` is empty in that case, so we
      // re-resolve it here from the same predicate.
      const slugsToRemove = createdSlugs.length > 0 ? createdSlugs : await collectL32CreatedSlugs(baselineSlugs, replyMarker);
      for (const slug of slugsToRemove) {
        await removeProjectSkill(slug);
      }
    }
  });
});

// L-32 cleanup helper. Pulled out of the spec so the assertion site
// and the cleanup site share one predicate; otherwise drift between
// the two would silently leave skill dirs on disk after a failed run.
async function collectL32CreatedSlugs(baselineSlugs: Set<string>, replyMarker: string): Promise<string[]> {
  const after = await snapshotProjectSkillSlugs();
  const candidates = [...after].filter((slug) => !baselineSlugs.has(slug));
  const matches: string[] = [];
  for (const slug of candidates) {
    const body = await readProjectSkillBody(slug);
    if (body !== null && body.includes(replyMarker)) {
      matches.push(slug);
    }
  }
  return matches;
}
