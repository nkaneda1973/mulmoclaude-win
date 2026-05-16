// Per-cycle state file.
//
// One cycle = one markdown file at obligations/<id>/<cycleId>.md.
// Frontmatter holds structured state (open/closed status,
// per-target step records, field values, activeNotificationId);
// body is free-form prose the user/LLM may append via appendNote.
//
// The records keys (`records[targetId]`) come from the DSL's
// `targets[].id`. Per-target field values live nested under
// `values:` so user-defined field names cannot collide with the
// structural keys (status / steps / values).

import { parseEncoreFrontmatter as parseFrontmatter, serializeEncoreFrontmatter as serializeWithFrontmatter } from "./yaml-fm.js";
import { resolveAtExpression } from "./dsl/at-resolver.js";
import { parseAtExpression } from "./dsl/at-expression.js";
import type { EncoreDsl, Severity } from "./dsl/schema.js";
import type { CycleSlot } from "./dsl/cadence.js";
import { cycleDeadline, cycleStart, formatCycleId } from "./dsl/cadence.js";

export type RecordStatus = "open" | "closed" | "skipped";

export interface StepState {
  status: RecordStatus;
  /** Resolved deadline date (ISO). */
  stepDeadline: string;
  /** Currently-active bell entry id, if any. */
  activeNotificationId: string | null;
  /** Last severity the tick published for this step (so escalation
   *  only fires on real severity transitions, not every tick). */
  lastPublishedSeverity: Severity | null;
}

export interface TargetRecord {
  status: RecordStatus;
  /** Per-cycle field values keyed by formSchema field name. */
  values: Record<string, unknown>;
  /** Per-step state keyed by step id. */
  steps: Record<string, StepState>;
}

export interface CycleState {
  cycleId: string;
  status: RecordStatus;
  cycleStart: string;
  cycleDeadline: string;
  /** Per-target record keyed by target id. */
  records: Record<string, TargetRecord>;
}

/** Build a fresh CycleState for a new cycle of the obligation.
 *  Pre-fills per-target defaults from the DSL's targets[].defaults
 *  and resolves each step's deadline against the cycle anchors. */
export function buildCycleState(dsl: EncoreDsl, slot: CycleSlot): CycleState {
  const startIso = cycleStart(dsl.cadence, slot);
  const deadlineIso = cycleDeadline(dsl.cadence, slot);

  const records: Record<string, TargetRecord> = {};
  for (const target of dsl.targets) {
    const values: Record<string, unknown> = {};
    for (const field of dsl.formSchema.fields) {
      values[field.name] = target.defaults?.[field.name] ?? null;
    }
    const steps: Record<string, StepState> = {};
    for (const step of dsl.steps) {
      const expr = parseAtExpression(step.deadline, { allowStepDeadline: false });
      const stepDeadline = resolveAtExpression(expr, { cycleStart: startIso, cycleDeadline: deadlineIso });
      steps[step.id] = {
        status: "open",
        stepDeadline,
        activeNotificationId: null,
        lastPublishedSeverity: null,
      };
    }
    records[target.id] = { status: "open", values, steps };
  }

  return {
    cycleId: formatCycleId(slot),
    status: "open",
    cycleStart: startIso,
    cycleDeadline: deadlineIso,
    records,
  };
}

/** Close a single step. Cascades target close when all its steps
 *  reach a terminal state, then cycle close when all targets do. */
export function closeStep(state: CycleState, targetId: string, stepId: string, values?: Record<string, unknown>): CycleState {
  const next = cloneState(state);
  const record = next.records[targetId];
  if (!record) throw new Error(`closeStep: unknown target ${JSON.stringify(targetId)}`);
  const step = record.steps[stepId];
  if (!step) throw new Error(`closeStep: unknown step ${JSON.stringify(stepId)} for target ${JSON.stringify(targetId)}`);
  step.status = "closed";
  step.activeNotificationId = null;
  if (values) {
    record.values = { ...record.values, ...values };
  }
  cascadeTargetClose(next, targetId);
  return next;
}

/** Mark an entire target skipped for this cycle. */
export function skipTarget(state: CycleState, targetId: string): CycleState {
  const next = cloneState(state);
  const record = next.records[targetId];
  if (!record) throw new Error(`skipTarget: unknown target ${JSON.stringify(targetId)}`);
  record.status = "skipped";
  for (const step of Object.values(record.steps)) {
    if (step.status === "open") {
      step.status = "skipped";
      step.activeNotificationId = null;
    }
  }
  cascadeCycleClose(next);
  return next;
}

/** Merge new field values onto a target without closing anything. */
export function applyValues(state: CycleState, targetId: string, values: Record<string, unknown>): CycleState {
  const next = cloneState(state);
  const record = next.records[targetId];
  if (!record) throw new Error(`applyValues: unknown target ${JSON.stringify(targetId)}`);
  record.values = { ...record.values, ...values };
  return next;
}

/** Snooze a step: clear its active notification id so the next tick
 *  treats it as un-fired, but keep the step open. The caller
 *  typically updates `lastPublishedSeverity` to null too so the
 *  next fire picks up at the appropriate phase. */
export function snoozeStep(state: CycleState, targetId: string, stepId: string): CycleState {
  const next = cloneState(state);
  const record = next.records[targetId];
  if (!record) throw new Error(`snoozeStep: unknown target ${JSON.stringify(targetId)}`);
  const step = record.steps[stepId];
  if (!step) throw new Error(`snoozeStep: unknown step ${JSON.stringify(stepId)}`);
  step.activeNotificationId = null;
  step.lastPublishedSeverity = null;
  return next;
}

function cascadeTargetClose(state: CycleState, targetId: string): void {
  const record = state.records[targetId];
  if (!record) return;
  const allDone = Object.values(record.steps).every((step) => step.status !== "open");
  if (allDone && record.status === "open") {
    record.status = "closed";
  }
  if (allDone) cascadeCycleClose(state);
}

function cascadeCycleClose(state: CycleState): void {
  const allDone = Object.values(state.records).every((record) => record.status !== "open");
  if (allDone && state.status === "open") {
    state.status = "closed";
  }
}

function cloneState(state: CycleState): CycleState {
  // Structured clone preserves nulls / nested values cleanly.
  return JSON.parse(JSON.stringify(state)) as CycleState;
}

// ── parse / serialize ─────────────────────────────────────────────

/** Parse a cycle file's raw markdown into (state, body). */
export function parseCycleFile(raw: string): { state: CycleState; body: string } {
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasHeader) {
    throw new Error("cycle file: missing YAML frontmatter");
  }
  const meta = parsed.meta as Partial<CycleState>;
  if (
    typeof meta.cycleId !== "string" ||
    typeof meta.status !== "string" ||
    typeof meta.cycleStart !== "string" ||
    typeof meta.cycleDeadline !== "string" ||
    typeof meta.records !== "object" ||
    meta.records === null
  ) {
    throw new Error("cycle file: frontmatter missing required fields (cycleId/status/cycleStart/cycleDeadline/records)");
  }
  return {
    state: {
      cycleId: meta.cycleId,
      status: meta.status as RecordStatus,
      cycleStart: meta.cycleStart,
      cycleDeadline: meta.cycleDeadline,
      records: meta.records as Record<string, TargetRecord>,
    },
    body: parsed.body,
  };
}

/** Serialize a CycleState + body back to markdown. */
export function serializeCycleFile(state: CycleState, body: string): string {
  return serializeWithFrontmatter(
    {
      cycleId: state.cycleId,
      status: state.status,
      cycleStart: state.cycleStart,
      cycleDeadline: state.cycleDeadline,
      records: state.records,
    },
    body,
  );
}
