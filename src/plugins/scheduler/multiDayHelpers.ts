import type { ScheduledItem } from "./index";

export type SegmentPosition = "only" | "start" | "middle" | "end";

export interface EventRange {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

export function eventRange(item: ScheduledItem): EventRange | null {
  const start = asIsoDate(item.props.date);
  if (!start) return null;
  const endRaw = asIsoDate(item.props.endDate);
  if (!endRaw) return { start, end: start };
  if (endRaw < start) return { start, end: start };
  return { start, end: endRaw };
}

export function coversDay(item: ScheduledItem, dateStr: string): boolean {
  const range = eventRange(item);
  if (!range) return false;
  return range.start <= dateStr && dateStr <= range.end;
}

export function segmentPosition(item: ScheduledItem, dateStr: string): SegmentPosition | null {
  const range = eventRange(item);
  if (!range) return null;
  if (dateStr < range.start || dateStr > range.end) return null;
  if (range.start === range.end) return "only";
  if (dateStr === range.start) return "start";
  if (dateStr === range.end) return "end";
  return "middle";
}
