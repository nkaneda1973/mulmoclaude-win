import { describe, it, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureBookDir, appendJournal, invalidateAllSnapshots, invalidateSnapshotsFrom, readSnapshot } from "../../server/utils/files/accounting-io.js";
import { balancesAtEndOf, getOrBuildSnapshot, rebuildAllSnapshots } from "../../server/accounting/snapshotCache.js";
import { makeEntry } from "../../server/accounting/journal.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-snap-"));
  created.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

async function seed(root: string): Promise<void> {
  await ensureBookDir("default", root);
  // Three months, mixed activity.
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-01-15",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "3000", credit: 1000 },
      ],
      kind: "opening",
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-02-10",
      lines: [
        { accountCode: "1000", credit: 200 },
        { accountCode: "5000", debit: 200 },
      ],
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-03-05",
      lines: [
        { accountCode: "1100", debit: 500 },
        { accountCode: "4000", credit: 500 },
      ],
    }),
    root,
  );
}

function balancesEqual(lhs: { accountCode: string; netDebit: number }[], rhs: { accountCode: string; netDebit: number }[]): boolean {
  if (lhs.length !== rhs.length) return false;
  const byCode = new Map(rhs.map((row) => [row.accountCode, row.netDebit]));
  for (const row of lhs) {
    const other = byCode.get(row.accountCode);
    if (other === undefined) return false;
    if (Math.abs(row.netDebit - other) > 0.0001) return false;
  }
  return true;
}

describe("snapshot cache byte-equality invariant", () => {
  it("getOrBuildSnapshot result == balancesAtEndOf result for every period", async () => {
    const root = makeTmp();
    await seed(root);
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const cached = await getOrBuildSnapshot("default", period, root);
      const fromJournal = await balancesAtEndOf("default", period, root);
      assert.ok(balancesEqual(cached.balances, fromJournal), `period ${period} should match`);
    }
  });
  it("survives full invalidation: rebuild from scratch yields the same numbers", async () => {
    const root = makeTmp();
    await seed(root);
    const snapBefore = await getOrBuildSnapshot("default", "2026-03", root);
    const wiped = await invalidateAllSnapshots("default", root);
    assert.deepEqual(wiped.removed.sort(), ["2026-01", "2026-02", "2026-03"]);
    assert.equal(await readSnapshot("default", "2026-03", root), null);
    const snapAfter = await getOrBuildSnapshot("default", "2026-03", root);
    assert.ok(balancesEqual(snapBefore.balances, snapAfter.balances));
  });
  it("rebuildAllSnapshots produces a snapshot for every journal period", async () => {
    const root = makeTmp();
    await seed(root);
    const result = await rebuildAllSnapshots("default", root);
    assert.deepEqual(result.rebuilt, ["2026-01", "2026-02", "2026-03"]);
    for (const period of result.rebuilt) {
      assert.ok((await readSnapshot("default", period, root)) !== null);
    }
  });
});

// Replaces what the old eager-rebuild queue used to guarantee. With
// the queue gone, every read goes through `getOrBuildSnapshot`'s
// lazy chain — so this stress test pins down the contract: after
// any sequence of far-back invalidations, every downstream month
// must still match `balancesAtEndOf` (the cache-bypass path) and
// the spot-checkable expected balance.
describe("lazy rebuild after far-back invalidation", () => {
  it("12-month seed + multiple mid-year invalidations: every month stays correct", async () => {
    const root = makeTmp();
    await ensureBookDir("default", root);

    // Seed: $100 cash inflow on the 15th of every month, Jan–Dec.
    // After warming, end-of-Mth cash = Mth × 100.
    for (let month = 1; month <= 12; month += 1) {
      const monthKey = String(month).padStart(2, "0");
      await appendJournal(
        "default",
        makeEntry({
          date: `2026-${monthKey}-15`,
          lines: [
            { accountCode: "1000", debit: 100 },
            { accountCode: "4000", credit: 100 },
          ],
        }),
        root,
      );
    }

    async function assertAllMonthsMatch(extras: Record<string, number>): Promise<void> {
      for (let month = 1; month <= 12; month += 1) {
        const period = `2026-${String(month).padStart(2, "0")}`;
        const cached = await getOrBuildSnapshot("default", period, root);
        const fromJournal = await balancesAtEndOf("default", period, root);
        assert.ok(balancesEqual(cached.balances, fromJournal), `period ${period}: cached vs lazy mismatch`);
        let expectedCash = month * 100;
        for (const [extraMonth, extraAmount] of Object.entries(extras)) {
          if (extraMonth <= period) expectedCash += extraAmount;
        }
        const cashRow = cached.balances.find((row) => row.accountCode === "1000");
        assert.equal(cashRow?.netDebit, expectedCash, `period ${period}: cash should be ${expectedCash}`);
      }
    }

    // Warm: build snapshots for every month so the subsequent
    // invalidations exercise the partial-invalidation path (not the
    // cold path the byte-equality test already covers).
    for (let month = 1; month <= 12; month += 1) {
      await getOrBuildSnapshot("default", `2026-${String(month).padStart(2, "0")}`, root);
    }
    await assertAllMonthsMatch({});

    // Stress 1: post a $50 entry mid-year (June). Snapshots Jul–Dec
    // are stale on disk after the invalidate; the lazy chain has to
    // rebuild them off the still-valid May snapshot.
    await appendJournal(
      "default",
      makeEntry({
        date: "2026-06-20",
        lines: [
          { accountCode: "1000", debit: 50 },
          { accountCode: "4000", credit: 50 },
        ],
      }),
      root,
    );
    await invalidateSnapshotsFrom("default", "2026-06", root);
    await assertAllMonthsMatch({ "2026-06": 50 });

    // Stress 2: deeper rewrite — post a $25 entry in February. Now
    // Feb–Dec are stale, including the freshly-rebuilt stress-1
    // snapshots. Forces a near-full re-walk.
    await appendJournal(
      "default",
      makeEntry({
        date: "2026-02-25",
        lines: [
          { accountCode: "1000", debit: 25 },
          { accountCode: "4000", credit: 25 },
        ],
      }),
      root,
    );
    await invalidateSnapshotsFrom("default", "2026-02", root);
    await assertAllMonthsMatch({ "2026-02": 25, "2026-06": 50 });

    // Stress 3: late-year mutation right after a deep one — verifies
    // the lazy chain doesn't depend on a contiguous warm-cache region
    // and that earlier extras still aggregate correctly.
    await appendJournal(
      "default",
      makeEntry({
        date: "2026-11-10",
        lines: [
          { accountCode: "1000", debit: 75 },
          { accountCode: "4000", credit: 75 },
        ],
      }),
      root,
    );
    await invalidateSnapshotsFrom("default", "2026-11", root);
    await assertAllMonthsMatch({ "2026-02": 25, "2026-06": 50, "2026-11": 75 });
  });
});
