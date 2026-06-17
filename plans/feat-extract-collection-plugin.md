# Extract presentCollection + collection engine → @mulmoclaude/collection-plugin

Goal: package the Collections feature so MulmoTerminal can import it like `@mulmoclaude/chart-plugin`.
Scope decided with the user: **Phase 1 only** (plugin + server + pure utils). The **browsable
pages** (standalone `/collections` + `/collections/:slug`) are **Phase 2** — blocked on a
`CollectionHostCapabilities` injection layer + the deferred `assetUrl` host-served-URL primitive
(same blocker that held presentHtml). See `feat-extract-present-plugins.md`.

## Surface (from exploration)
- Plugin `src/plugins/presentCollection/` — `executePresentCollection` is PURE (validate+echo, no
  backend); View mounts the heavy `CollectionView.vue` (2,131 LOC, router/host-coupled).
- Pure utils `src/utils/collections/*` — the **canonical isomorphic logic**; the server already
  reaches into `src/` for `deriveAll` + `actionVisible` (cross-boundary smell to remove).
- Two overlapping schema type systems: `server/workspace/collections/types.ts` (375, canonical
  rich) and `src/components/collectionTypes.ts` (210, frontend subset + UI types, 13 importers).
- Server engine `server/workspace/collections/*` + `api/routes/collections.ts` + `manageCollection.ts`
  (~3,900 LOC, filesystem-only, cleanly movable).

## Chunked plan (each a reviewable commit/PR)
- **1a — isomorphic engine (this chunk).** Move the 3 pure, type-self-contained modules
  (`derivedFormula`, `deriveAll`, `actionVisible`) into the package `core` (`.` export, dual
  ESM+CJS). Rewire all importers (server: derive/notifications/collections/types/discovery;
  frontend: CollectionView/KanbanView/RecordPanel/useCollectionRendering/draft; tests). Removes the
  server→`src/` reach-in. **No type-consolidation needed** — these use local structural types.
- **1b — schema types.** Consolidate the canonical `CollectionSchema`/field/action/view types into
  the package core; server `types.ts` + frontend `collectionTypes.ts` re-export from it (frontend
  keeps UI-only additions: TableRowDraft/EditState/caches). Then move the remaining pure utils
  (sortItems, itemLabel, draft, notifiedItems, calendarGrid, enumColors, collectionViewMode).
- **1c — server engine.** Move `server/workspace/collections/*` + `api/routes/collections.ts` +
  `manageCollection.ts` into the package (server entry), reached via generic context where it needs
  host I/O. Host keeps thin route adapters.
- **1d — plugin core + Preview + View.** definition/execute/types/Preview (pure → easy). View needs
  `CollectionView`; its host coupling (router, useAppApi, useShortcuts, useNotifications,
  useCollectionRendering preview URLs) is feature-gated/injected — the embedded/card path only.

## Type-consolidation strategy (1b)
Server `types.ts` is the source of truth (rich, validated). Package core re-exports it; frontend
`collectionTypes.ts` aliases the shared types + keeps UI-only types. Verify frontend
`FieldSpec`/`CollectionSchema` are structurally compatible before collapsing (they look like a subset).

## Publish gate
Like chart/x: once the launcher depends on it, `@mulmoclaude/collection-plugin@0.1.x` must be
published or smoke's tarball stage 404s.
