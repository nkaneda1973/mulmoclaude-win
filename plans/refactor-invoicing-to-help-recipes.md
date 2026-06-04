# Migrate the invoicing suite from preset skills to help-file recipes

**Status:** planning · **Owner:** snakajima · **Created:** 2026-06-04

## Rationale

The invoicing suite ships today as four bundled preset skills under
`server/workspace/skills-preset/`: `mc-clients`, `mc-worklog`, `mc-invoice`,
`mc-profile`. Each is a schema-driven collection (`SKILL.md` + `schema.json`,
plus four action templates for `mc-invoice`). They are synced into
`data/skills/catalog/preset/` on every boot and must be **starred** in the
skill manager to become active — `syncActivePresetSkills` never auto-stars them.

Two problems:

1. **Discoverability.** The skill manager / catalog is hard to find and the
   catalog↔active "star" gesture is non-obvious, so most users never light up
   the suite even when they'd want it. It's clutter for everyone who doesn't.
2. **Maintenance + correctness coupling.** Four preset dirs are overwritten on
   every boot; any change is host-side and ships to all users unconditionally.

The **todo list already demonstrates the better model**: there is no preset
`todos` skill. `config/helps/todo-collection.md` is a recipe with copy-paste
`schema.json` + `SKILL.md` blocks, and a **sample query** ("make me a todo
list") triggers Claude to scaffold it on demand into `data/skills/todos/`. The
bridge mirrors it and `/collections/todos` renders — the skill manager is never
involved.

**Decision:** move the invoicing suite to the same recipe model. The collections
engine is fully generic — verified that **no host code depends on the `mc-*`
slugs** (every `mc-clients`/`mc-invoice`/`mc-profile`/`mc-worklog` hit outside
`skills-preset/` is a comment, a doc example, a help cross-ref, or a link-router
test fixture). So the suite is pure data + prompt and can live entirely in
recipes.

## Shape: two bundles, two sample queries

Per the dependency graph (verified against the four `schema.json` files):

| Collection | Outbound references |
|---|---|
| `clients` | none (foundation) |
| `worklog` | `clientId` → `clients` (required) |
| `profile` | none (singleton foundation, `singleton: "me"`) |
| `invoice` | `clientId` → `clients` (required); `embed` `profile/me`; soft-reads `worklog` for the "invoice my hours" flow; 4 actions in the `accounting` role |

Bundles:

- **Bundle A — `clients` + `worklog`** → fully self-contained (`worklog → clients`
  is internal). No external deps.
- **Bundle B — `invoice` + `profile`** → `invoice → profile` embed is internal,
  but `invoice → clients` (required ref) and the worklog data-pull point **into
  Bundle A**.

Install matrix:

- **A alone** → fully works (contact book + timesheet). ✓
- **A then B** → clean. ✓
- **B then A** → fine: refs resolve lazily at render, so invoice's `clientId`
  links light up once A is installed. Same end state regardless of order. ✓
- **B alone** → invoice works but is **degraded**: empty client picker (no
  `clients` collection to populate it), worklog data-pull unavailable so it
  falls back to manual line items.

**Mitigation for B-alone:** Bundle B's recipe is **dependency-aware** — when
scaffolding `invoice` it checks whether a `clients` collection exists and, if
not, prompts the user "Invoicing links to a Clients collection — add the Clients
& Worklog bundle too?". The `invoice` SKILL already degrades gracefully on
missing worklog ("if no matching entries, ask for line items") — no change there.

### Slug contract (both files must agree)

De-`mc-` the slugs to `clients` / `worklog` / `invoice` / `profile`. Bundle B's
`ref to: "clients"` and `embed to: "profile"` MUST match what Bundle A (and B)
create. Bake the exact slugs into both recipe files. `dataPath` values are
**already** prefix-free in the presets (`data/clients/items`, `data/invoice/items`,
…), so de-slugging changes only the collection URL and the ref/embed targets —
**no record data moves.**

### Verbatim-schema rule

Each recipe carries its collections' **known-good `schema.json` + `SKILL.md`**
(and invoice's four action template bodies) as literal copy blocks — NOT "design
an invoicing app from the DSL." Financial correctness is preserved; we're only
changing the delivery vehicle. Diff from the current presets: `to:` targets
de-`mc-`'d, and the SKILL/description cross-references updated to the new slugs.

## Files

### New (sources live in repo; helps are dir-copied via `readdirSync`, no manifest — drop the file and it ships)

- `server/workspace/helps/billing-clients-worklog.md` — Bundle A recipe:
  verbatim `clients` + `worklog` schema/SKILL blocks, slug contract, dependency-
  order note (clients before worklog), de-`mc-`'d `worklog.clientId → clients`.
- `server/workspace/helps/billing-invoice.md` — Bundle B recipe: verbatim
  `invoice` + `profile` schema/SKILL blocks + the four action templates
  (`invoice.md`, `journal-sale.md`, `journal-payment.md`, `journal-void.md`),
  de-`mc-`'d `clientId → clients` / `embed → profile`, and the dependency-aware
  "add the clients bundle too?" prompt instruction.

### Delete (preset dirs)

- `server/workspace/skills-preset/mc-clients/` (SKILL.md + schema.json)
- `server/workspace/skills-preset/mc-worklog/` (SKILL.md + schema.json)
- `server/workspace/skills-preset/mc-invoice/` (SKILL.md + schema.json + templates/{invoice,journal-sale,journal-payment,journal-void}.md)
- `server/workspace/skills-preset/mc-profile/` (SKILL.md + schema.json)

### Edit — discoverability

- `src/config/roles.ts` — add two `queries` entries so the bundles are
  discoverable from a sample prompt. Recommended home: the **`general`** role
  (default landing role; collection skills are not role-gated — see the existing
  note at l.366-368). Proposed strings:
  - "Set up client and time tracking for my consulting work"
  - "Set up invoicing for my business"
  - (Alternative / additional home: the `office` role, l.145-153.)

### Edit — repoint help/doc cross-refs that currently point at the deleted presets

- `server/workspace/helps/collection-skills.md`:
  - l.46-47 — "reserved for the bundled presets (`mc-clients` …)" — reword now
    that they're recipe-authored, not boot-overwritten presets.
  - l.128, l.135 — `ref`/`embed` examples use `mc-clients` / `mc-profile`;
    update to `clients` / `profile` for consistency.
  - l.587-600 "Worked reference: the billing suite" — currently says "read their
    `schema.json` when in doubt" pointing at the deleted preset dirs. Repoint to
    the two recipe files (the schemas now live there).
- `server/workspace/helps/index.md` — add links to the two new recipes (mirror
  how `todo-collection.md` is linked).

### Verify during implementation (blast-radius unknowns)

- **Stale catalog prune.** `syncPresetSkills` does `rmSync` + full copy *per
  source dir*. Once the four source dirs are deleted, confirm whether stale
  `data/skills/catalog/preset/mc-*` dirs from prior boots are pruned or linger.
  If they linger, add a prune step (or document that they're inert).
  (`server/workspace/skills-preset.ts` ~l.157-236.)
- **Tests referencing the presets.** Grep `test/`, `e2e/`, `e2e-live/` for
  `mc-clients`/`mc-invoice`/`mc-profile`/`mc-worklog` and any preset-count
  assertions in skills-preset / collections discovery tests; update counts and
  fixtures.

## Existing users (decision: leave + document)

Users who already starred the `mc-*` presets have live data at
`data/{clients,worklog,invoice,profile}/items`. Once the source dirs are deleted:

- The boot overwrite of those presets stops; a previously-starred
  `.claude/skills/mc-invoice` lingers and **keeps working unchanged** against the
  same `data/invoice/items` (refs still target `mc-clients`, which also lingers).
- New users get the bare-slug recipe versions (`/collections/invoice`, etc.),
  backed by the **same** `data/*/items` folders.

Net: existing starred users keep `mc-*` slugs; new users get bare slugs; data is
shared and untouched. **No data migration.** Note the cosmetic slug difference
in `docs/CHANGELOG.md`. (Alternative considered and rejected for now: a recipe
rewrite step that detects an `mc-*` suite and re-slugs it — more complexity and a
riskier one-time rewrite of financial collections.)

### Docs

- `docs/CHANGELOG.md` — entry: invoicing suite moved from preset skills to help
  recipes; existing starred installs keep working; new installs use bare slugs.
- `docs/dsl-as-harness.md` (l.323-371) — uses `mc-profile`/`mc-clients` as
  *illustrative* DSL examples (not live-file pointers). Optional: align to bare
  slugs for consistency. Low priority — not required for correctness.

## Deliberately NOT in scope

- The other `mc-*` presets (`mc-cooking-coach`, `mc-library`, `mc-wiki-*`,
  `mc-manage-*`) — only the invoicing four move.
- The built-in `accounting` role and `manageAccounting` plugin — invoice actions
  keep targeting `role: "accounting"`; the role is untouched.
- Record data and `dataPath` values — unchanged (already prefix-free).

## Verification checklist

- [ ] Fresh workspace: "Set up client and time tracking" → A scaffolds
      `data/skills/{clients,worklog}/`, renders at `/collections/clients` +
      `/collections/worklog`, `worklog.clientId` picker lists clients.
- [ ] Fresh workspace: "Set up invoicing" → B scaffolds `invoice` + `profile`,
      and (clients absent) prompts to add Bundle A.
- [ ] A-then-B and B-then-A both reach an identical working end state (invoice
      links clients, embeds profile, pulls worklog hours).
- [ ] All four invoice actions (PDF / sale / payment / void) open a seeded
      `accounting` chat with the de-`mc-`'d record.
- [ ] No stale `data/skills/catalog/preset/mc-{clients,worklog,invoice,profile}`
      after a boot (or documented as inert).
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` clean; unit +
      e2e suites updated for removed presets.

## Open decisions for review

1. Sample-query home — `general` (recommended) vs `office` vs both?
2. Recipe filenames — `billing-clients-worklog.md` / `billing-invoice.md`
   (proposed) vs another naming.
3. Confirm "leave existing users, document only" (no re-slug migration).
