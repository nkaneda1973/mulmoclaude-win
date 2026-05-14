// Test-only LLM backend. Loaded by `getActiveBackend()` only when
// `MULMOCLAUDE_FAKE_AGENT=1` (CI workflow boot wiring), and re-usable
// from unit tests via `setFakeResponse()` / `resetFakeResponse()`.
//
// Default behavior:
//   - emits a synthesized `claudeSessionId` so the orchestrator's
//     resume bookkeeping sees the same shape as a real run
//   - inspects the user prompt for "use X tool" / "presentY ツール"
//     phrasings (see detectToolCalls below) and emits the matching
//     tool_call + tool_call_result events, so plugin Views land in
//     the canvas without a real LLM
//   - emits the concatenated per-session message history as the
//     assistant text reply, so context-recall tests (session L-12)
//     see prior turn content
//
// The pattern detector is intentionally narrow — only the prompts
// e2e-live actually ships. Tests that need different behavior call
// `setFakeResponse(fn)` to swap in a custom generator and
// `resetFakeResponse()` in teardown.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { EVENT_TYPES } from "../../../src/types/events.js";
import type { AgentEvent } from "../stream.js";
import type { AgentInput, LLMBackend } from "./types.js";

export interface FakeToolCall {
  toolName: string;
  args: unknown;
  /** Result string emitted in the matching `tool_call_result`.
   *  Defaults to `{ ok: true }` JSON. */
  result?: string;
}

export interface FakeResponse {
  /** Tool calls emitted before the text block. */
  toolCalls?: readonly FakeToolCall[];
  /** Assistant text. Omit to skip the text event entirely. */
  text?: string;
}

export type FakeResponseFn = (input: AgentInput) => FakeResponse | Promise<FakeResponse>;

// Per-session conversation memory so context-recall tests see prior
// turn content in the reply. Cleared by `resetFakeResponse()`.
const sessionTurns = new Map<string, string[]>();

async function defaultResponse(input: AgentInput): Promise<FakeResponse> {
  // Slash-command turn shape: the SPA's "Run" button on a skill row
  // (e2e-live L-22) starts a new chat with `/<slug>` as the only
  // user message. Real Claude resolves this through its skill
  // pipeline and uses the SKILL.md body as system prompt; here we
  // short-circuit to read the seeded body and apply the
  // "respond with this exact line" heuristic the e2e-live canaries
  // rely on. Falls through to default-echo on no match (so a stray
  // /text in a real chat doesn't break unrelated tests).
  const slashMatch = input.message.trim().match(/^\/([a-z0-9][a-z0-9-]*)$/i);
  if (slashMatch) {
    const skillReply = await replyFromSeededSkill(input.workspacePath, slashMatch[1]);
    if (skillReply !== null) return { text: skillReply };
  }

  const history = sessionTurns.get(input.sessionId) ?? [];
  history.push(input.message);
  sessionTurns.set(input.sessionId, history);

  const toolCalls = detectToolCalls(input.message);
  return {
    toolCalls,
    text: history.join("\n\n"),
  };
}

// Look up a project-scope skill seeded by `placeProjectSkill` in
// e2e-live, and extract the line the seeded canary asks the model
// to echo back ("respond with this exact line and nothing else: X").
// Returns null when the file is missing or the marker shape is
// absent — caller falls through to default echo.
async function replyFromSeededSkill(workspacePath: string, slug: string): Promise<string | null> {
  const skillFile = path.join(workspacePath, ".claude/skills", slug, "SKILL.md");
  let body: string;
  try {
    body = await readFile(skillFile, "utf8");
  } catch {
    return null;
  }
  // Line-by-line scan to avoid backtracking surprises. Locates the
  // canary phrase and returns the rest of the same line.
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/respond with this exact line(?: and nothing else)?:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

// ── Tool-call pattern detectors ───────────────────────────────────
//
// Each detector matches one e2e-live prompt shape. Keep them
// narrow + commented: a regex collision could quietly swallow a
// chat-text test by emitting an unexpected tool call.

function detectPresentMulmoScript(message: string): FakeToolCall | null {
  if (!/presentMulmoScript/i.test(message)) return null;
  // L-EDIT: `presentMulmoScript ツールに filePath: "<path>" を渡して`
  const filePathMatch = message.match(/filePath:\s*["']([^"']+)["']/);
  if (!filePathMatch) return null;
  return { toolName: "presentMulmoScript", args: { filePath: filePathMatch[1] } };
}

function detectPresentHtml(message: string): FakeToolCall | null {
  // L-01: `以下の HTML を presentHtml ツールで...` followed by inline HTML.
  if (!/presentHtml/i.test(message)) return null;
  // Heuristic: HTML is everything from the first `<` onward.
  const idx = message.indexOf("<");
  if (idx < 0) return null;
  return { toolName: "presentHtml", args: { html: message.slice(idx).trim() } };
}

function detectPresentForm(message: string): FakeToolCall | null {
  // L-18: `Use the presentForm tool to display a single-field form
  // titled 'Quick check'. Add one required text field with
  // id='nickname', label='Nickname', ...`
  if (!/presentForm/i.test(message)) return null;
  const titleMatch = message.match(/titled\s+['"]([^'"]+)['"]/i);
  const idMatch = message.match(/id\s*=\s*['"]([^'"]+)['"]/i);
  const labelMatch = message.match(/label\s*=\s*['"]([^'"]+)['"]/i);
  return {
    toolName: "presentForm",
    args: {
      title: titleMatch?.[1] ?? "Quick check",
      fields: [
        {
          id: idMatch?.[1] ?? "field1",
          type: "text",
          label: labelMatch?.[1] ?? "Field",
          required: /required/i.test(message),
          description: "auto-generated by fake-echo",
        },
      ],
    },
  };
}

function detectPresentChart(message: string): FakeToolCall | null {
  // L-21: `Use the presentChart tool to render a bar chart titled
  // 'L-21 sales' with data Jan 100, Feb 150, Mar 120.`
  // Detector is conservative — only fires when presentChart is named.
  if (!/presentChart/i.test(message)) return null;
  const titleMatch = message.match(/titled\s+['"]([^'"]+)['"]/i);
  // Collect (label, value) pairs of the shape `Mon 100`. The series-
  // category extraction is best-effort: if the prompt drifts and we
  // can't find any pairs, we still emit a chart with placeholder
  // data so the canvas mounts (the test asserts on the chart-canvas
  // testid, not on specific values).
  const pairs = Array.from(message.matchAll(/\b([A-Za-z]{3,})\s+(\d{1,6})\b/g)).map(([, label, value]) => ({ label, value: Number(value) }));
  const labels = pairs.length > 0 ? pairs.map((pair) => pair.label) : ["A", "B", "C"];
  const values = pairs.length > 0 ? pairs.map((pair) => pair.value) : [1, 2, 3];
  const title = titleMatch?.[1] ?? "Untitled";
  return {
    toolName: "presentChart",
    args: {
      document: {
        title,
        charts: [
          {
            title,
            type: "bar",
            option: {
              xAxis: { type: "category", data: labels },
              yAxis: { type: "value" },
              series: [{ type: "bar", data: values }],
            },
          },
        ],
      },
    },
  };
}

function detectToolCalls(message: string): FakeToolCall[] | undefined {
  const calls: FakeToolCall[] = [];
  for (const detector of [detectPresentMulmoScript, detectPresentHtml, detectPresentForm, detectPresentChart]) {
    const call = detector(message);
    if (call) calls.push(call);
  }
  return calls.length > 0 ? calls : undefined;
}

// ── Backend wiring ────────────────────────────────────────────────

let responseFn: FakeResponseFn = defaultResponse;

/** Replace the default echo+detect generator. Useful for unit tests
 *  that want full control over what the fake backend emits. Pair
 *  with `resetFakeResponse()` in teardown so the next test sees a
 *  clean state. */
export function setFakeResponse(generator: FakeResponseFn): void {
  responseFn = generator;
}

/** Restore the default generator AND clear per-session history. */
export function resetFakeResponse(): void {
  responseFn = defaultResponse;
  sessionTurns.clear();
}

async function* runFakeEchoAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  yield { type: EVENT_TYPES.claudeSessionId, id: randomUUID() };

  const response = await responseFn(input);

  for (const call of response.toolCalls ?? []) {
    const toolUseId = `fake-${randomUUID()}`;
    yield {
      type: EVENT_TYPES.toolCall,
      toolUseId,
      toolName: call.toolName,
      args: call.args,
    };
    yield {
      type: EVENT_TYPES.toolCallResult,
      toolUseId,
      content: call.result ?? '{"ok":true}',
    };
  }

  if (response.text !== undefined) {
    yield { type: EVENT_TYPES.text, message: response.text };
  }
}

export const fakeEchoBackend: LLMBackend = {
  id: "fake-echo",
  // Resume-by-token / MCP aren't meaningfully replayable from a
  // stub. Flag them unsupported so callers that depend on the real
  // Claude semantics opt out instead of getting silently wrong
  // behavior.
  capabilities: { sessionResume: false, mcp: false },
  runAgent: runFakeEchoAgent,
};
