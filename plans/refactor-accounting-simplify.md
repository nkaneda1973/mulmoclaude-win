# Accounting plugin: simplify cache + sync model

## Goal

Two focused simplifications to `src/plugins/accounting/` and `server/accounting/`, motivated by the project philosophy "the workspace is the database; files are the source of truth; UI updates via pub/sub":

1. **Drop the background snapshot-rebuild queue.** Snapshots are derived state; the lazy `getOrBuildSnapshot` already returns the correct number for any read. The eager queue is prepayment that costs us ~150 LOC of race-handling for no functional benefit on personal/SMB books.
2. **Trust pub/sub as the single sync signal.** The `View` currently maintains `bookVersion = pubsubVersion + localVersion`, where children bump `localVersion` after every successful write — but the same write triggers a server-side `publishBookChange(...)` that the client receives over SSE within milliseconds. Two bumps per user action; race-handling state exists *because of* the dual-tracking.

## Non-goals

- No change to the journal-as-source-of-truth invariant. Snapshots remain a perf cache only.
- No change to the action surface (`ACCOUNTING_ACTIONS` stays as-is).
- No change to LLM-facing tool descriptions or prompts.
- No work on recommendations #3–#6 from the review (move plugin files into the plugin folder, split message-builders out of the route, drop the redundant cache re-export, etc). Those are separate PRs.

## Change #1 — drop the snapshot rebuild queue

**Why:** writes mostly land in the current month. Reads are interactive — the lazy `getOrBuildSnapshot` chains back to the most recent cached snapshot and computes only the missing months on demand. For a typical book that's "last cached month → today", microseconds. The eager background queue exists to prepay this cost, but in exchange:

- per-book queue map with coalescing + `pendingFromPeriod` min-merge
- `isInvalidatedDuringRebuild` race guard (writes-during-rebuild can't pollute cache)
- `cancelRebuild` + `awaitRebuildIdle`, called from `deleteBook` to stop a rebuild from re-creating the book directory via `mkdir-recursive` after `removeBookDir`
- `_resetRebuildQueueForTesting` shim
- two pub/sub event kinds nobody renders (`snapshotsRebuilding`, `snapshotsReady`)
- a `scheduleRebuild → invalidateSnapshotsFrom` ordering dance in every write path of `service.ts`, plus prose comments explaining why that order matters

The byte-equality invariant test (cached path === lazy path) stays — that's the safety net that makes the lazy fallback sufficient.

### Files touched

#### `server/accounting/snapshotCache.ts` — major surgery

Remove:
- `RebuildQueueEntry` interface
- `rebuildQueues` module-level Map
- `minPeriod`, `isInvalidatedDuringRebuild`, `isCancelled`
- `runRebuild`, `startRebuild`
- `scheduleRebuild` (exported)
- `cancelRebuild` (exported)
- `awaitRebuildIdle` (exported)
- `inspectRebuildQueue` (exported, test-only diagnostic)
- `_resetRebuildQueueForTesting` (exported, test-only)
- The `invalidateSnapshotsFrom` re-export pass-through (callers go straight to `accounting-io`)
- Module-doc paragraph about the rebuild policy

Keep:
- `previousPeriod`, `mergeBalances`, `buildEmptySnapshot` (helpers)
- `getOrBuildSnapshot` (lazy chain)
- `balancesAtEndOf` (cache-bypass path; safety net + invariant test)
- `rebuildAllSnapshots` (used by the admin `rebuildSnapshots` action — stays synchronous)

Net: ~333 → ~120 LOC.

#### `server/accounting/service.ts`

- Drop imports: `awaitRebuildIdle`, `cancelRebuild`, `scheduleRebuild`.
- `addEntry` / `voidEntry` / `setOpeningBalances` / `upsertAccount`: drop the `scheduleRebuild(...)` call (single line each; the `await invalidateSnapshotsFrom(...)` already on the next line stays).
- `deleteBook`: drop the `cancelRebuild(input.bookId)` + `await awaitRebuildIdle(input.bookId)` pair. Without a background rebuild that could re-create the directory, `removeBookDir` is safe on its own.
- `rebuildSnapshots` admin action: drop the `publishBookChange(... snapshotsReady)` (the event kind is going away). Replace with a `kind: ACCOUNTING_BOOK_EVENT_KINDS.accounts` event so the View refetches the report tabs after a manual rebuild.
- Update the file-header comment: drop the "Snapshot rebuild policy" paragraph; keep the "snapshots are cache only" line.

#### `src/config/pubsubChannels.ts`

- Remove `snapshotsRebuilding` and `snapshotsReady` from `ACCOUNTING_BOOK_EVENT_KINDS`.
- Update the doc comment on `period?: string` to drop the "snapshot events" reference.

#### `test/accounting/test_snapshotCache.ts`

- Drop the entire `describe("scheduleRebuild + queue", …)` block (lines ~128–240).
- Drop the imports: `_resetRebuildQueueForTesting`, `awaitRebuildIdle`, `inspectRebuildQueue`, `scheduleRebuild`.
- Drop `_resetAccountingEventPublisherForTesting` / `initAccountingEventPublisher` / pubsub-recording helpers if they become unused after removing the queue describe.
- Keep the byte-equality, invalidation, and `rebuildAllSnapshots` tests.

#### `test/accounting/test_service.ts`

- Drop the `_resetRebuildQueueForTesting` + `awaitRebuildIdle` import.
- Drop the `beforeEach(async () => await _resetRebuildQueueForTesting())`.
- Drop the `drainRebuilds(bookId)` helper and its three call sites — writes are now fully synchronous wrt snapshot state.

### Risk assessment for #1

- **Read latency after a large write burst.** Adding 1000 entries to the current month means the next `getOrBuildSnapshot(currentMonth)` will read the journal and recompute. For a personal book this is sub-millisecond; for a 10k-entry book it might be ~10ms. Acceptable.
- **`rebuildSnapshots` admin action becomes synchronous.** It already was — `rebuildAllSnapshots` loops `getOrBuildSnapshot` directly in the request handler. No change.
- **Test suite shrinks by ~110 lines of queue-specific tests** that no longer test anything real. Acceptable.

## Change #2 — trust pub/sub as the only sync signal

**Why:** every mutating service function calls `publishBookChange(...)` after writing. The same client that posted the mutation receives the event back over SSE within milliseconds. Maintaining a separate `localVersion` that children bump after a successful POST means every `watch(version, refetch)` in the table/report components re-fires twice per user action.

The dual-tracking also seeds the optimistic-insert in `onBookCreated` (which causes the `pendingTargetBookId` race-handling) and parts of the `deletedNoticeName` flow. Killing the dual signal removes a subtle source of race-window bugs.

### Files touched

#### `src/plugins/accounting/View.vue`

- Remove `localVersion = ref(0)`, `bumpLocalVersion()`, and the `bookVersion` computed.
- Replace every `:version="bookVersion"` prop with `:version="pubsubVersion"` (rename the destructured `version` from `useAccountingChannel` if helpful).
- Drop `@changed="bumpLocalVersion"` from `<JournalList>`.
- Drop `@accounts-changed="bumpLocalVersion"` from `<JournalEntryForm>` and `<OpeningBalancesForm>`.
- Keep `@submitted="onEntrySubmitted"` — `onEntrySubmitted` still needs to switch tabs (UX, not data sync). After the trim it must do **two** things: (1) clear `entryBeingEdited.value = null` so the next visit to "New entry" starts blank instead of re-prefilling the just-replaced entry; (2) switch to the journal tab. Drop only the `bumpLocalVersion()` call — preserve the rest.
- Update the multi-paragraph comment around `bookVersion` to a one-line note (or delete it; the simpler code is self-explanatory).
- **Preserve the merge-added edit-flow plumbing in full**: `entryBeingEdited` ref, `onEditEntry` / `onCancelEdit` handlers, the `watch(activeBookId, …)` that clears the edit on book switch, and the `@edit-entry` / `:entry-to-edit` / `@cancel-edit` template wiring. These carry user intent (which entry the user wants to edit) — orthogonal to the data-sync signal we're collapsing.

#### Children — drop now-unused emits

- `JournalList.vue`: drop `changed` from `defineEmits`; drop `emit("changed")` from `onVoid`. Keep `editEntry` and `editOpening` — both carry user intent that pub/sub can't replicate.
- `JournalEntryForm.vue`: drop `accountsChanged` from `defineEmits`; drop the inner `@changed="emit('accountsChanged')"` on `<AccountsModal>`. Keep `submitted` and `cancelEdit`.
- `OpeningBalancesForm.vue`: drop `accountsChanged` from `defineEmits`; drop the inner `@changed="emit('accountsChanged')"` on `<AccountsModal>`. Keep `submitted`.
- `AccountsModal.vue`: keep `emit("changed")` — the modal uses it internally to refresh its own accounts list after an upsert (independent of the now-removed parent wiring).

#### What stays

- `useAccountingBooksChannel(refetchBooks)` already drives book-list refetches via pub/sub. Keep.
- The `BookSwitcher` `book-created` event flow (optimistic insert) is more nuanced — it exists to prevent the dropdown from "sticking on the old selection" while the books refetch lands. **Out of scope for this PR.** Tackle in a follow-up if the simpler pub/sub-only path proves stable.
- Same for `deletedNoticeName` — keep as-is. Removing the dual-version signal is the smallest reversible step; the deleted-notice race is tied to the books-list optimistic insert, not the per-book version model.

### Risk assessment for #2

- **Perceived latency on form submit.** Currently: form posts, server publishes, *and* child emits `changed` → table refetches before SSE arrives. After: table refetches when SSE arrives (~10–50ms on localhost, ~100ms on real network). For a single-user local app this is imperceptible.
- **SSE drop.** If pub/sub delivery drops a message (server crash mid-publish, websocket reconnect window), the table won't refetch. Currently the `localVersion` masked this by re-fetching anyway. Mitigation: every component already re-fetches on mount and on `bookId` change, and the user can manually click a refresh button on every report tab. Acceptable for v1; if it becomes a real issue, add a "stale > Ns → refetch" heuristic.
- **No multi-tab regression.** Pub/sub events fan out to every connected tab equally, so cross-tab sync (which the local-version bump never participated in) is unaffected.
- **Edit-entry double-fire.** The merged "edit" flow posts `voidEntry` then `addEntry` sequentially, each publishing a `journal` pub/sub event. With `localVersion` removed, subscribers refetch twice in quick succession instead of once. Still correct, still cheap (~ms-scale fetches), but worth noting — a future debounce/coalesce in the subscriber composable could collapse them if it ever matters.
- **Pub/sub vs UX state — preserved boundary.** The cleanup only removes the *data-sync* duplicate. Tab switches, edit-mode resets, and other UX state changes stay tied to local Vue parent-child emits (`@submitted`, `@cancelEdit`, `@editEntry`, `@editOpening`) and never to pub/sub — a pub/sub event that came from another tab / window / LLM tool call must NEVER hijack the active tab's UI state.

## Sequencing

Two commits on `refactor/accounting-simplify`:

1. **Plan commit** — this document.
2. **#1 commit: `refactor(accounting): drop background snapshot rebuild queue`** — server-side simplification, channel kinds removal, test pruning. No frontend changes.
3. **#2 commit: `refactor(accounting): drop View localVersion, trust pub/sub`** — frontend simplification only.

Splitting #1 and #2 lets either be reverted independently if a regression surfaces.

## Acceptance criteria

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` all green.
- `server/accounting/snapshotCache.ts` < 150 LOC.
- `server/accounting/service.ts` no longer imports anything queue-related from `snapshotCache.ts`.
- `src/config/pubsubChannels.ts` no longer mentions snapshot events.
- `View.vue` no longer maintains `localVersion`; sub-components no longer emit `changed` / `accountsChanged` to the View.
- Manual smoke test: `npm run dev`, create a book, set opening balances, post an entry, void it. Each action lands in the journal/B-S/P-L within ~100ms. (Recorded in PR description; not automated here.)

## Out of scope (follow-ups)

- Move `useAccountingChannel.ts`, the `accountingBookChannel`/`ACCOUNTING_BOOK_EVENT_KINDS`/`PUBSUB_CHANNELS.accountingBooks` block, and `accounting-io.ts` into the plugin folder (review recommendation #3).
- Split `MESSAGE_BUILDERS` / `PREVIEW_ACTIONS` out of `server/api/routes/accounting.ts` into a dedicated module (review recommendation #5).
- Re-evaluate the optimistic `onBookCreated` insert + `pendingTargetBookId` flow once #2 has been live for a few sessions (review recommendation #6).
