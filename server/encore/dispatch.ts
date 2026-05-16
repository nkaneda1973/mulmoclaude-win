// Encore plugin — server-side handler module.
//
// Step 3 of plans/feat-encore-as-builtin.md: setup / amendDefinition
// / query / appendNote land here. The remaining kinds (markStepDone
// / markTargetSkipped / recordValues / snooze / resolveNotification)
// still return "not implemented" stubs — Steps 4 and 5 fill them in.
//
// `dispatch(body)` is the single entry point; the Express adapter in
// `server/api/routes/encore.ts` calls it. Each handler returns a
// `{ ok, message, ... }` object; the route serialises it as JSON to
// both the browser (for in-page dispatch) and the MCP bridge (for
// LLM tool calls).
//
// Mutex serialisation lands in Step 4. For now handlers run in
// parallel — Step 3 doesn't kick the tick, so the race surface is
// just `writeFileAtomic` overlap, which the underlying tmp+rename
// already tolerates for serialised same-key writes.

import { z } from "zod";

import { EncoreDslInput, type EncoreDsl } from "./dsl/schema.js";
import { buildCycleState, parseCycleFile, serializeCycleFile, type CycleState } from "./cycle.js";
import { parseIndexFile, serializeIndexFile } from "./obligation.js";
import { currentCycleSlot } from "./dsl/cadence.js";
import { obligationDir, obligationIndexPath, cycleFilePath, slugify, OBLIGATIONS_DIRNAME } from "./paths.js";
import { exists, readDir, readTextOrNull, writeText } from "../utils/files/encore-io.js";
import { WORKSPACE_DIRS } from "../workspace/paths.js";
import { log } from "../system/logger/index.js";

// ── error types + envelope ────────────────────────────────────────

export interface EncoreDispatchBody {
  kind: string;
  [key: string]: unknown;
}

export interface EncoreDispatchResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export class EncoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "EncoreError";
  }
}

// ── per-kind Zod arg schemas ──────────────────────────────────────

const SetupArgs = z.object({
  kind: z.literal("setup"),
  definition: z.unknown(),
});

const AmendArgs = z.object({
  kind: z.literal("amendDefinition"),
  obligationId: z.string(),
  definition: z.record(z.string(), z.unknown()),
});

const QueryArgs = z.object({
  kind: z.literal("query"),
  obligationId: z.string().optional(),
  range: z.union([z.literal("current"), z.literal("all"), z.number().int().positive()]).optional(),
  targetId: z.string().optional(),
});

const AppendNoteArgs = z.object({
  kind: z.literal("appendNote"),
  obligationId: z.string(),
  cycleId: z.string().optional(),
  body: z.string().min(1),
});

// ── path / id helpers ─────────────────────────────────────────────

async function generateUniqueObligationId(displayName: string): Promise<string> {
  const base = slugify(displayName);
  if (!(await exists(obligationIndexPath(base)))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(obligationIndexPath(candidate)))) return candidate;
  }
  throw new EncoreError(500, `failed to generate a unique obligation id from displayName ${JSON.stringify(displayName)} (tried ${base} through ${base}-999)`);
}

// ── handlers ──────────────────────────────────────────────────────

async function handleSetup(args: z.infer<typeof SetupArgs>): Promise<EncoreDispatchResult> {
  let dsl: EncoreDsl;
  try {
    dsl = EncoreDslInput.parse(args.definition);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, formatZodError(err), { issues: err.issues });
    }
    throw err;
  }

  const obligationId = await generateUniqueObligationId(dsl.displayName);
  const fullDsl: EncoreDsl = {
    ...dsl,
    id: obligationId,
    createdAt: new Date().toISOString(),
  };

  // Provision the first cycle synchronously so the obligation has
  // something to fire against on the very next tick.
  const slot = currentCycleSlot(fullDsl.cadence, new Date());
  const cycle = buildCycleState(fullDsl, slot);

  await writeText(obligationIndexPath(obligationId), serializeIndexFile(fullDsl, ""));
  await writeText(cycleFilePath(obligationId, cycle.cycleId), serializeCycleFile(cycle, ""));

  log.info("encore", "setup: obligation created", { obligationId, cycleId: cycle.cycleId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(dsl.displayName)} created (id: ${obligationId}, first cycle: ${cycle.cycleId}, deadline: ${cycle.cycleDeadline}).`,
    obligationId,
    cycleId: cycle.cycleId,
    cyclePath: workspaceRelativePath(cycleFilePath(obligationId, cycle.cycleId)),
    indexPath: workspaceRelativePath(obligationIndexPath(obligationId)),
  };
}

async function handleAmend(args: z.infer<typeof AmendArgs>): Promise<EncoreDispatchResult> {
  const indexPath = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexPath);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl: existing, body } = parseIndexFile(raw);
  const patch = args.definition;

  // Immutable fields per Resolved #15 / #10: type, currency, and
  // cadence.type. Changing them would invalidate prior cycle records
  // (currency mid-life), break cycle-file naming (cadence.type), or
  // change the validation discriminator (type). Path: retire + new.
  if ("type" in patch && patch.type !== existing.type) {
    throw new EncoreError(400, "amendDefinition: changing `type` is not allowed — retire and create a new obligation");
  }
  if (existing.type === "payment" && "currency" in patch && patch.currency !== existing.currency) {
    throw new EncoreError(400, "amendDefinition: changing `currency` is not allowed — retire and create a new obligation");
  }
  if ("cadence" in patch) {
    const newCadence = patch.cadence as { type?: string } | undefined;
    if (newCadence && typeof newCadence.type === "string" && newCadence.type !== existing.cadence.type) {
      throw new EncoreError(400, "amendDefinition: changing `cadence.type` is not allowed — retire and create a new obligation");
    }
  }

  // Shallow merge at the top level, array fields replace whole.
  const merged: Record<string, unknown> = { ...(existing as unknown as Record<string, unknown>), ...patch };
  // Preserve server-generated fields if the caller didn't pass them.
  if (!("id" in patch)) merged.id = existing.id;
  if (!("createdAt" in patch)) merged.createdAt = existing.createdAt;

  let validated: EncoreDsl;
  try {
    validated = EncoreDslInput.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, `amendDefinition: ${formatZodError(err)}`, { issues: err.issues });
    }
    throw err;
  }

  await writeText(indexPath, serializeIndexFile(validated, body));
  log.info("encore", "amendDefinition: obligation updated", { obligationId: args.obligationId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(validated.displayName)} updated (id: ${args.obligationId}).`,
    obligationId: args.obligationId,
    indexPath: workspaceRelativePath(indexPath),
  };
}

interface QueryCycleResult {
  cycleId: string;
  path: string;
  state: CycleState;
  body: string;
}

interface QueryObligationResult {
  obligationId: string;
  indexPath: string;
  dsl: EncoreDsl;
  body: string;
  cycles: QueryCycleResult[];
}

async function handleQuery(args: z.infer<typeof QueryArgs>): Promise<EncoreDispatchResult> {
  const range = args.range ?? "current";

  // List of obligations to inspect: either the named one, or all of
  // them (when no obligationId is passed).
  let obligationIds: string[];
  if (args.obligationId) {
    obligationIds = [args.obligationId];
  } else {
    obligationIds = (await readDir(OBLIGATIONS_DIRNAME)).sort();
  }

  const results: QueryObligationResult[] = [];
  for (const obligationId of obligationIds) {
    const indexRel = obligationIndexPath(obligationId);
    const indexRaw = await readTextOrNull(indexRel);
    if (indexRaw === null) {
      if (args.obligationId) {
        throw new EncoreError(404, `obligation ${JSON.stringify(obligationId)} not found`);
      }
      continue;
    }
    const { dsl, body } = parseIndexFile(indexRaw);
    const cycles = await readCyclesForObligation(obligationId, range);
    results.push({
      obligationId,
      indexPath: workspaceRelativePath(indexRel),
      dsl,
      body,
      cycles,
    });
  }

  return {
    ok: true,
    message: queryMessage(results, range),
    obligations: results,
  };
}

async function readCyclesForObligation(obligationId: string, range: "current" | "all" | number): Promise<QueryCycleResult[]> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  // Sorted ascending; the most recent cycle is the last entry. For
  // "current" we return the single latest open cycle (or the latest
  // entry if none are open); for "all" we return everything; for a
  // numeric range we return the last N entries.
  const slice = range === "all" ? cycleFiles : cycleFiles.slice(-(range === "current" ? 1 : range));
  const out: QueryCycleResult[] = [];
  for (const filename of slice) {
    const rel = `${obligationDir(obligationId)}/${filename}`;
    const raw = await readTextOrNull(rel);
    if (raw === null) continue;
    try {
      const parsed = parseCycleFile(raw);
      out.push({
        cycleId: filename.replace(/\.md$/, ""),
        path: workspaceRelativePath(rel),
        state: parsed.state,
        body: parsed.body,
      });
    } catch (err) {
      log.warn("encore", "query: skipping unparsable cycle file", {
        obligationId,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function queryMessage(results: QueryObligationResult[], range: "current" | "all" | number): string {
  if (results.length === 0) {
    return "Encore: no obligations found.";
  }
  const lines: string[] = [];
  const rangeLabel = typeof range === "number" ? `last ${range}` : range;
  for (const result of results) {
    lines.push(`- ${result.dsl.displayName} (${result.obligationId}, status: ${result.dsl.status}): ${result.cycles.length} cycle(s) in ${rangeLabel}`);
    for (const cycle of result.cycles) {
      lines.push(`  - ${cycle.cycleId} [${cycle.state.status}] start=${cycle.state.cycleStart} deadline=${cycle.state.cycleDeadline} path=${cycle.path}`);
    }
  }
  return lines.join("\n");
}

async function handleAppendNote(args: z.infer<typeof AppendNoteArgs>): Promise<EncoreDispatchResult> {
  if (args.cycleId) {
    const rel = cycleFilePath(args.obligationId, args.cycleId);
    const raw = await readTextOrNull(rel);
    if (raw === null) {
      throw new EncoreError(404, `cycle file ${args.obligationId}/${args.cycleId}.md not found`);
    }
    const { state, body } = parseCycleFile(raw);
    const newBody = appendBody(body, args.body);
    await writeText(rel, serializeCycleFile(state, newBody));
    log.info("encore", "appendNote: cycle body updated", { obligationId: args.obligationId, cycleId: args.cycleId });
    return {
      ok: true,
      message: `Note appended to cycle ${args.cycleId} of ${args.obligationId}.`,
      obligationId: args.obligationId,
      cycleId: args.cycleId,
      path: workspaceRelativePath(rel),
    };
  }

  const indexRel = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexRel);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl, body } = parseIndexFile(raw);
  const newBody = appendBody(body, args.body);
  await writeText(indexRel, serializeIndexFile(dsl, newBody));
  log.info("encore", "appendNote: obligation body updated", { obligationId: args.obligationId });
  return {
    ok: true,
    message: `Note appended to obligation ${args.obligationId}.`,
    obligationId: args.obligationId,
    path: workspaceRelativePath(indexRel),
  };
}

function appendBody(existing: string, addition: string): string {
  if (existing.trim().length === 0) return addition.endsWith("\n") ? addition : `${addition}\n`;
  const sep = existing.endsWith("\n") ? "" : "\n";
  const tail = addition.endsWith("\n") ? addition : `${addition}\n`;
  return `${existing}${sep}\n${tail}`;
}

// ── shared helpers ────────────────────────────────────────────────

function formatZodError(err: z.ZodError): string {
  // First issue's path + message — Claude reads this and either
  // self-corrects or asks the user. The full issues list is in
  // `details` for clients that want the structured form.
  const [first] = err.issues;
  const pathStr = first.path.length > 0 ? first.path.map((segment) => String(segment)).join(".") : "(root)";
  return `DSL validation failed at ${pathStr}: ${first.message}. Read config/helps/encore-dsl.md for the full grammar.`;
}

function workspaceRelativePath(rel: string): string {
  return `${WORKSPACE_DIRS.encore}/${rel}`;
}

// ── dispatch ──────────────────────────────────────────────────────

const KIND_ARGS = {
  setup: SetupArgs,
  amendDefinition: AmendArgs,
  query: QueryArgs,
  appendNote: AppendNoteArgs,
} as const;

async function handleNotImplemented(kind: string): Promise<EncoreDispatchResult> {
  return {
    ok: false,
    message: `Encore ${JSON.stringify(kind)} is not implemented yet — Steps 4-5 of plans/feat-encore-as-builtin.md fill the remaining actions in.`,
  };
}

export async function dispatch(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  if (!body || typeof body !== "object") {
    throw new EncoreError(400, "request body must be an object with a string `kind` field");
  }
  const { kind } = body;
  if (typeof kind !== "string") {
    throw new EncoreError(400, "missing or non-string `kind`");
  }

  if (kind === "setup") return handleSetup(KIND_ARGS.setup.parse(body));
  if (kind === "amendDefinition") return handleAmend(KIND_ARGS.amendDefinition.parse(body));
  if (kind === "query") return handleQuery(KIND_ARGS.query.parse(body));
  if (kind === "appendNote") return handleAppendNote(KIND_ARGS.appendNote.parse(body));

  // Step 4 / Step 5 surface area.
  if (kind === "markStepDone" || kind === "markTargetSkipped" || kind === "recordValues" || kind === "snooze" || kind === "resolveNotification") {
    return handleNotImplemented(kind);
  }

  throw new EncoreError(400, `unknown kind ${JSON.stringify(kind)}`);
}
