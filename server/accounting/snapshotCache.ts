// Monthly balance snapshot cache.
//
// Source of truth: the journal JSONL files. Snapshots are derived
// state — `data/accounting/books/<id>/snapshots/YYYY-MM.json` is
// only ever a perf optimization. The invariant we maintain:
//
//   for any (book, period) pair,
//     getOrBuildSnapshot(book, period)
//   ===
//     aggregateBalances(<all entries up to period end>)
//
// I.e. running with snapshots and running without snapshots must
// produce byte-identical results. The unit test for this lives in
// `test/accounting/test_snapshotCache.ts`.
//
// Reads use the lazy `getOrBuildSnapshot` chain — it walks back to
// the most recent cached snapshot (or the earliest journal month if
// none exists), then folds forward. Writes invalidate stale snapshot
// files via `invalidateSnapshotsFrom`; the next read regenerates
// on demand.
//
// Concurrency: every snapshot build (read path) and every
// invalidation (write path) on the same book serializes through
// `withBookLock`. Without this, a reader could (a) see no cached
// snapshot, (b) read journal at state J1, (c) get overtaken by a
// writer that appends + invalidates (the invalidate is a no-op
// because the snapshot file doesn't exist yet), and (d) persist J1
// balances to disk — leaving a stale snapshot until some later
// write happens to invalidate that period. The lock pins the
// invalidate's relative order to the read's writeSnapshot, so any
// stale snapshot the reader writes is removed by the writer's
// invalidate immediately after, and the next read regenerates.
// Single-process only — fine for this app, which keeps one Node
// process per workspace.

import {
  invalidateAllSnapshots,
  invalidateSnapshotsFrom,
  listJournalPeriods,
  readJournalMonth,
  readSnapshot,
  writeSnapshot,
} from "../utils/files/accounting-io.js";
import { aggregateBalances } from "./report.js";
import type { AccountBalance, JournalEntry, MonthSnapshot } from "./types.js";

// Per-book serialization. Each entry is the tail of a chain of
// pending operations on that book; new callers chain onto it. The
// finally branch deletes the entry when the chain drains, so books
// that stop being touched stop holding memory.
const bookLocks = new Map<string, Promise<void>>();

async function withBookLock<T>(bookId: string, run: () => Promise<T>): Promise<T> {
  const previous = bookLocks.get(bookId) ?? Promise.resolve();
  // `settled` resolves once `run` finishes (success or failure). The
  // next chained caller awaits this through `chained`; we never
  // forward `run`'s rejection into the chain, so one failure doesn't
  // poison subsequent operations.
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const chained = previous.then(() => settled);
  bookLocks.set(bookId, chained);
  try {
    await previous;
    return await run();
  } finally {
    resolveSettled();
    if (bookLocks.get(bookId) === chained) {
      bookLocks.delete(bookId);
    }
  }
}

function previousPeriod(period: string): string {
  // YYYY-MM → previous YYYY-MM. December rolls back to the previous
  // year's December.
  const [year, month] = period.split("-").map((segment) => parseInt(segment, 10));
  if (month === 1) return `${(year - 1).toString().padStart(4, "0")}-12`;
  return `${year.toString().padStart(4, "0")}-${(month - 1).toString().padStart(2, "0")}`;
}

function mergeBalances(base: readonly AccountBalance[], delta: readonly AccountBalance[]): AccountBalance[] {
  const map = new Map<string, number>();
  for (const row of base) map.set(row.accountCode, row.netDebit);
  for (const row of delta) {
    map.set(row.accountCode, (map.get(row.accountCode) ?? 0) + row.netDebit);
  }
  return Array.from(map.entries())
    .map(([accountCode, netDebit]) => ({ accountCode, netDebit }))
    .sort((lhs, rhs) => lhs.accountCode.localeCompare(rhs.accountCode));
}

async function buildEmptySnapshot(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot> {
  const empty: MonthSnapshot = { period, balances: [], builtAt: new Date().toISOString() };
  await writeSnapshot(bookId, empty, workspaceRoot);
  return empty;
}

// Inner build path that assumes the caller already holds the
// per-book lock. Recurses to itself for the prior-period chain so
// the recursion stays inside the same critical section.
async function buildSnapshotLocked(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot> {
  const cached = await readSnapshot(bookId, period, workspaceRoot);
  if (cached) return cached;

  const periods = await listJournalPeriods(bookId, workspaceRoot);
  if (periods.length === 0 || period < periods[0]) {
    return buildEmptySnapshot(bookId, period, workspaceRoot);
  }

  const { entries } = await readJournalMonth(bookId, period, workspaceRoot);
  const monthDelta = aggregateBalances(entries);

  let priorBalances: readonly AccountBalance[] = [];
  if (period > periods[0]) {
    const prior = previousPeriod(period);
    const priorSnap = await buildSnapshotLocked(bookId, prior, workspaceRoot);
    priorBalances = priorSnap.balances;
  }
  const merged = mergeBalances(priorBalances, monthDelta);
  const snap: MonthSnapshot = {
    period,
    balances: merged,
    builtAt: new Date().toISOString(),
  };
  await writeSnapshot(bookId, snap, workspaceRoot);
  return snap;
}

/** Build a snapshot at end-of-`period` for one book, lazily relying
 *  on the previous month's snapshot if it exists. Falls all the way
 *  back to the earliest journal month if no upstream snapshot is
 *  available. Always writes the result to disk before returning. */
export async function getOrBuildSnapshot(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot> {
  // Fast path: cache hit, no lock needed. Stale reads are
  // self-correcting — a stale snapshot only exists momentarily
  // before the writer's locked invalidate removes it.
  const cached = await readSnapshot(bookId, period, workspaceRoot);
  if (cached) return cached;
  return withBookLock(bookId, () => buildSnapshotLocked(bookId, period, workspaceRoot));
}

/** Compute closing balances at end-of-`period` from journal alone,
 *  bypassing the snapshot cache. Used by the byte-equality
 *  invariant test, and as a safety net for "compute without
 *  trusting cache" paths. */
export async function balancesAtEndOf(bookId: string, period: string, workspaceRoot?: string): Promise<AccountBalance[]> {
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const all: JournalEntry[] = [];
  for (const monthKey of periods) {
    if (period < monthKey) break;
    const { entries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const entry of entries) all.push(entry);
  }
  return aggregateBalances(all);
}

/** Drop all snapshots and rebuild from scratch. Used by the
 *  `rebuildSnapshots` admin action. Returns the periods that were
 *  rebuilt. */
export async function rebuildAllSnapshots(bookId: string, workspaceRoot?: string): Promise<{ rebuilt: string[] }> {
  return withBookLock(bookId, async () => {
    await invalidateAllSnapshots(bookId, workspaceRoot);
    const periods = await listJournalPeriods(bookId, workspaceRoot);
    for (const monthKey of periods) {
      await buildSnapshotLocked(bookId, monthKey, workspaceRoot);
    }
    return { rebuilt: periods };
  });
}

/** Locked variants of the file-IO invalidate helpers. Use these
 *  from any code path (e.g. service.ts addEntry / voidEntry) that
 *  needs to invalidate snapshots while concurrent reads may be in
 *  flight — they share the per-book mutex with `getOrBuildSnapshot`
 *  so an invalidate can't slip between a reader's journal walk and
 *  its writeSnapshot. The raw helpers in `accounting-io.ts` stay
 *  available for paths that already hold the lock (or that don't
 *  need it, e.g. tests / admin reset). */
export async function lockedInvalidateSnapshotsFrom(bookId: string, fromPeriod: string, workspaceRoot?: string): Promise<{ removed: string[] }> {
  return withBookLock(bookId, () => invalidateSnapshotsFrom(bookId, fromPeriod, workspaceRoot));
}

export async function lockedInvalidateAllSnapshots(bookId: string, workspaceRoot?: string): Promise<{ removed: string[] }> {
  return withBookLock(bookId, () => invalidateAllSnapshots(bookId, workspaceRoot));
}
