# Plan: `money` + `enum` Field Types for Collections

Second of three follow-up PRs aimed at making the schema-driven
collection primitive expressive enough for invoice migration.
Follow-up to [plans/feat-collections-ref-field.md](feat-collections-ref-field.md)
(merged); next is PR-C (`table` + `derived` for line items) then
PR-D (mc-invoice + actions + PDF template renderer).

## Scope

Two new field types added together because each is small and they
share the same shape pattern PR-A established:

1. **`money`** — number stored as a decimal, displayed via
   `Intl.NumberFormat` (`$15.50`, `¥1,500`) in the table and as a
   number input in the form. Optional `currency: "USD" | "JPY" | …`
   on the schema (defaults to `"USD"`).

2. **`enum`** — string constrained to a fixed list of allowed
   values. Form input is a `<select>` populated from the schema's
   declared `values: string[]`. Table cell shows the raw value;
   per-value badge styling (color chips like the invoice plugin's
   `paid` / `void`) is deferred to a follow-up.

Both unlock mc-invoice's most common fields (line-item `rate`
amounts, invoice `status`) without yet committing to the bigger
`table` / `derived` / `actions` work that comes next.

## Schema language additions

```jsonc
"rate": {
  "type": "money",
  "currency": "USD",          // optional, defaults to "USD"
  "label": "Rate"
},
"status": {
  "type": "enum",
  "values": ["draft", "sent", "paid", "void"],
  "label": "Status",
  "required": true
}
```

## Host changes

### Server (`server/workspace/collections/`)

- `types.ts`: add `"money"` and `"enum"` to `CollectionFieldType`;
  `CollectionFieldSpec` gains optional `currency?: string` and
  `values?: string[]`.
- `discovery.ts`: extend the Zod refine to require:
  - `enum` fields must declare a non-empty `values` array of strings
  - `money` fields' `currency` (if present) must be a non-empty string
  - bare `type: "enum"` (no `values`) is rejected at discovery, same
    way `ref` without `to` is rejected.

### Frontend (`src/components/CollectionView.vue`)

- Type updates mirroring the server schema.
- **Money in the table**: `Intl.NumberFormat(locale, { style: "currency", currency })` for display. Falls back to the raw number on format failure (e.g. unknown currency code).
- **Money in the form**: `<input type="number" step="0.01">` bucketed into `editing.text` (same as the existing `number` type); `draftToRecord` converts to a number on save.
- **Enum in the form**: `<select>` populated from `field.values`. No fallback needed (the schema declares all valid options).
- **Enum in the table**: raw value (per-value badge styling deferred).

### i18n

The existing `collectionsView.refPlaceholder` ("Select…") is now shared
by both `ref` and `enum` dropdowns. **Rename to
`collectionsView.selectPlaceholder`** for accuracy across all 8
locales — small mechanical change to keep the key name truthful
before another field type adds a third use.

### Skill updates

None in this PR. `money` and `enum` aren't used by any current
mc-* preset; they're put in place ready for mc-invoice in PR-C/D.

## Deferred

- **Per-value badge styling** for enum cells (draft = gray pill, paid = green pill, etc.). Cosmetic; defer until invoice ships and we know what palette feels right.
- **Currency conversion** between locales. v0 displays whatever currency the schema declares; locale only affects digit grouping / decimal separator via `Intl.NumberFormat`.
- **Server-side enum validation**: client can't submit an invalid value (the `<select>` restricts to declared options), but Claude could write whatever string into the JSON. Defer enforcement until orphan handling is more broadly designed.
- **Subtotal / total aggregations** — that's `derived` (PR-C).

## Test plan

After `yarn dev`:

- [ ] Existing `mc-clients` / `mc-worklog` collections still load (no regression from the type-enum extension)
- [ ] A test fixture schema declaring `money` and `enum` validates and renders
- [ ] Discovery rejects `enum` without `values`, with empty `values`, with non-string `values`
- [ ] Discovery rejects `money` with `currency: ""` (must be non-empty if present)
- [ ] All existing tests + 437 e2e still pass

## What success looks like

- Two new field types cost ~80 LoC total (similar order of magnitude as ref)
- Schema language extension pattern (PR-A established, PR-B confirms it scales) is now reusable as a true template
- PR-C (table + derived) can start without any further server scaffolding
