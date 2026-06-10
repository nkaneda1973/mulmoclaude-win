// Client-side ID helpers. Mirrors `server/utils/id.ts` for the
// frontend — see issue #723 for the full design rationale.
//
// `makeUuid()` backs the per-action tool-call `uuid` fields emitted by
// `src/plugins/*/index.ts`. `shortHexId()` backs UI-side record naming:
// pre-filling a new collection record's primary key with the same id
// shape the server would have generated for a blank-id POST.

/**
 * Full UUID v4 (36 chars, hyphenated).
 *
 * Used as the per-action `uuid` on ToolResult payloads so the
 * renderer can track which action a result belongs to across a
 * session.
 */
export function makeUuid(): string {
  return crypto.randomUUID();
}

/**
 * 8-char hex id — short, slug-safe (matches `SAFE_SLUG_PATTERN`), and
 * editable. Mirrors the server's `generateItemId()`
 * (`randomBytes(4).toString("hex")`) so a UI-created collection record
 * gets the same id shape the server would have generated for a form
 * submitted with a blank primary key.
 */
export function shortHexId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
