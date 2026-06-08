// A standard, ordered colour palette for `enum` field values, shared by every
// collection surface (list, calendar, kanban, dashboard). Each value in an
// enum's `values` array is assigned the palette entry at its index — cycling
// when an enum declares more values than the palette holds — so colouring is
// automatic and consistent without any per-value schema config.
//
// Tailwind only detects class names that appear as complete string literals,
// so every surface's classes are spelled out per colour below rather than
// built from a colour name at runtime.
//
// One enum is special: the field a schema's `notifyWhen` targets (the
// "notification enum"). Its flagged values read the notification severity
// colours — the first flagged value (most urgent) red, the rest amber — and
// every other value reads neutral grey, mirroring the notification bell
// (red = urgent, amber = nudge) rather than the rotating palette.
// `resolveEnumColor` encapsulates that rule.

import type { CollectionSchema } from "../../components/collectionTypes";

export interface EnumColorClasses {
  /** Dashboard stat card: border + fill + text + hover. */
  card: string;
  /** Small status dot (kanban column header, dashboard row). */
  dot: string;
  /** Pill / badge / inline `<select>` fill + text (no border width). */
  badge: string;
  /** Border colour, paired with a `border` width class by the caller. */
  border: string;
}

// Order matters: rose and amber sit LAST (indices 6-7) so the common small
// enums (≤6 values) never draw a colour that reads like the notification
// red/amber, keeping the notification-enum scheme visually distinct.
const PALETTE: readonly EnumColorClasses[] = [
  {
    card: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
    dot: "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700",
    border: "border-indigo-200",
  },
  {
    card: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
  },
  { card: "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100", dot: "bg-sky-500", badge: "bg-sky-100 text-sky-700", border: "border-sky-200" },
  {
    card: "border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100",
    dot: "bg-violet-500",
    badge: "bg-violet-100 text-violet-700",
    border: "border-violet-200",
  },
  { card: "border-teal-200 bg-teal-50 text-teal-600 hover:bg-teal-100", dot: "bg-teal-500", badge: "bg-teal-100 text-teal-700", border: "border-teal-200" },
  {
    card: "border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100",
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700",
    border: "border-orange-200",
  },
  { card: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100", dot: "bg-rose-500", badge: "bg-rose-100 text-rose-700", border: "border-rose-200" },
  {
    card: "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    border: "border-amber-200",
  },
];

/** Neutral styling for the empty / Uncategorized bucket — never a palette
 *  colour, so an unset or unknown value reads grey across every surface. */
export const ENUM_NEUTRAL: EnumColorClasses = {
  card: "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
  dot: "bg-slate-300",
  badge: "bg-slate-100 text-slate-500",
  border: "border-slate-200",
};

/** The urgent notification colour (red), matching the bell's `urgent`
 *  severity. The first value a schema's `notifyWhen` flags reads this. */
export const ENUM_ALERT: EnumColorClasses = {
  card: "border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
  dot: "bg-red-500",
  badge: "bg-red-100 text-red-700",
  border: "border-red-200",
};

/** The nudge notification colour (amber), matching the bell's `nudge`
 *  severity. Flagged `notifyWhen` values after the first read this. */
export const ENUM_NUDGE: EnumColorClasses = {
  card: "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100",
  dot: "bg-amber-500",
  badge: "bg-amber-100 text-amber-700",
  border: "border-amber-200",
};

/** Classes for the enum value at `index` in its field's `values` array. A
 *  negative index (value unset or not among the declared values) reads
 *  neutral. */
export function enumColorClasses(index: number): EnumColorClasses {
  if (index < 0) return ENUM_NEUTRAL;
  return PALETTE[index % PALETTE.length] ?? ENUM_NEUTRAL;
}

/** Index of `value` within an enum field's declared `values`, or -1 when the
 *  value is empty / unknown (→ neutral). */
export function enumValueIndex(values: readonly string[] | undefined, value: unknown): number {
  if (value === undefined || value === null || value === "") return -1;
  return values?.indexOf(String(value)) ?? -1;
}

/** The flagged values when `fieldKey` is the schema's `notifyWhen` target (the
 *  "notification enum"); undefined for every other field. */
function notifyValuesFor(schema: CollectionSchema, fieldKey: string): readonly string[] | undefined {
  const spec = schema.notifyWhen;
  return spec && spec.field === fieldKey ? spec.in : undefined;
}

/** Resolve a value's colour for enum field `fieldKey`:
 *  - Notification enum (`notifyWhen` targets it): the first flagged value (in
 *    `notifyWhen.in` order, the most urgent) reads notification red, the rest
 *    amber, and every non-flagged value neutral grey.
 *  - Any other enum: the standard palette by the value's declared index. */
export function resolveEnumColor(schema: CollectionSchema, fieldKey: string, value: unknown): EnumColorClasses {
  const notifyValues = notifyValuesFor(schema, fieldKey);
  if (notifyValues) {
    const str = value === undefined || value === null ? "" : String(value);
    const rank = notifyValues.indexOf(str);
    if (rank < 0) return ENUM_NEUTRAL;
    return rank === 0 ? ENUM_ALERT : ENUM_NUDGE;
  }
  return enumColorClasses(enumValueIndex(schema.fields[fieldKey]?.values, value));
}
