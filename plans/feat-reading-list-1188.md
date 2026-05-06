# reading-list plugin (PR-A of #1188 / #1169 My Library)

First slice of the **My Library** plugin set from #1169. Same shape
as recipe-book (#1175 / #1183) — one runtime plugin, one tool, one
canvas view, one role. Layered as a preset so it ships on every
fresh checkout.

## Scope

### Plugin: `@mulmoclaude/reading-list-plugin`

- Tool: `manageReadingList` with kinds `list / read / save / update / delete`
- Storage: one markdown file per book at `<plugin-data>/books/<slug>.md`
- Frontmatter fields: `title`, `author`, `isbn` (optional), `status`
  (`want | reading | read | abandoned`), `rating` (1-5, optional),
  `startedAt` (date, optional), `finishedAt` (date, optional),
  `tags` (string[]), `created` (ISO 8601), `updated` (ISO 8601)
- Body: free-form markdown — notes, quotes, takeaways
- Slug rules: same as recipe-book (lowercase ASCII letters + digits +
  hyphens, 1-64 chars, no leading/trailing/consecutive hyphens)
- Multi-tab live sync via `pubsub.publish("changed", ...)` after every
  mutation; the View subscribes and refetches

### Role: `librarian`

Added in `src/config/roles.ts`:

- Friendly, focused on the user's reading habit — not bookkeeping
- Workflow prompts for save / list / read / update / delete
- Hints on slug picking (romanise non-ASCII titles), body convention
  (`## Notes` for thoughts, optional `## Quotes` for marked passages)
- Mentions that `articles` and `quotes` siblings are coming in PR-B / PR-C
- `availablePlugins` lists `presentForm` + `generateImage` (book covers
  on request) per the recipe-book precedent — `manageReadingList` is
  auto-included as a runtime plugin

## Files

```
packages/reading-list-plugin/
├── eslint.config.mjs
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── definition.ts         # TOOL_DEFINITION shared by index.ts + vue.ts
    ├── index.ts              # definePlugin factory + manageReadingList handler
    ├── vue.ts                # browser entry exporting { toolDefinition, viewComponent }
    ├── View.vue              # two-pane list + markdown detail
    ├── shims-vue.d.ts
    └── lang/
        ├── en.ts
        ├── ja.ts
        └── index.ts          # useT() composable + format() helper
```

Host wiring:

- `server/plugins/preset-list.ts` — append the new package
- `src/config/roles.ts` — append the `librarian` role
- `package.json` — add `@mulmoclaude/reading-list-plugin` workspace
  symlink (yarn workspaces handle the rest)
- `package.json#scripts.build:packages` and `build:packages:dev` — add
  the new workspace to the parallel build list

## Tests

- `test/plugins/test_reading_list_integration.ts` — end-to-end through
  the real loader + `makePluginRuntime`. Same shape as
  `test_recipe_book_integration.ts`:
  - happy path (save → read → update → delete with field round-trip)
  - metadata preservation (a body-only update keeps existing tags / rating / dates)
  - status transitions (`want → reading → read`) preserve `created`
  - invalid slugs / missing titles rejected
  - duplicate save returns `{ ok: false, error: "exists" }`
  - delete is idempotent (`not_found` after first delete)
- Skip-on-no-dist guard so test runs locally even before
  `yarn build:packages` if the dev hasn't built yet; CI builds first.

## Out of scope (deferred)

- ISBN lookup (Google Books / OpenLibrary) — comes later, paired
  with the `browse` plugin
- Reading-progress tracking (current page, % done) — yagni until
  asked
- Cross-plugin queries (Quote linkage from book back to its
  reading-list entry) — needs PR-C `quotes` first
- Articles plugin — PR-B
