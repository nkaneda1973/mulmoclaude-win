import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatTime, formatShortTime, formatShortDate, formatMonthYear } from "../../../src/utils/format/date.js";

describe("formatDate", () => {
  it("returns a non-empty string for a valid ISO date", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("contains digits (some form of time/day)", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    assert.match(out, /\d/);
  });

  it("does not throw for an unparseable input", () => {
    // Locale-aware formatting of an invalid Date never throws — it
    // returns a placeholder string ("Invalid Date" / "Invalid Date
    // Invalid Date" depending on locale). We only assert the safety
    // contract: the function must not bubble an exception up to the
    // UI render path.
    assert.doesNotThrow(() => formatDate("not a date"));
    // And it returns a non-empty placeholder string of some kind.
    const out = formatDate("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.match(out, /Invalid Date/);
  });

  it("differs across days at the same time", () => {
    const dateJan = formatDate("2026-01-01T12:00:00Z");
    const dateDec = formatDate("2026-12-31T12:00:00Z");
    assert.notEqual(dateJan, dateDec);
  });
});

// Fixed instant for the test suite below. Using `Date.now()` would
// make assertions non-deterministic — the test would pass on any
// string-looking output regardless of whether the formatter pulled a
// digit out of the actual input. With a frozen epoch we can also
// assert that the day-of-month survives, so a future bug that
// returns "Invalid Date" but still includes some digit gets caught.
// (Sourcery review on PR #1316.)
//
// Day 10 is the only locale-independent numeric substring we can
// rely on: the year is omitted from formatDateTime / formatShortDate
// (month + day + time only), and the month abbreviation varies by
// locale. Picking day-of-month >= 13 would also disambiguate from
// the hour, but day 10 is fine here because the hour formatting
// uses 12-hour AM/PM (max "12") which can collide with day 12 but
// not day 10.
const FIXED_INSTANT = new Date(Date.UTC(2026, 3, 10, 12, 0, 0));
const FIXED_EPOCH = FIXED_INSTANT.getTime();

describe("formatDateTime", () => {
  it("returns a non-empty string carrying the input's day-of-month", () => {
    const out = formatDateTime(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.match(out, /\b10\b/);
  });
});

describe("formatTime", () => {
  it("renders the hour from a fixed epoch", () => {
    const out = formatTime(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    // UTC 12:00 becomes the user's local clock hour; assert that
    // SOME two-digit hour appears (locale-independent) and a digit
    // pair separator that looks like time.
    assert.match(out, /\d{1,2}/);
  });
});

describe("formatShortTime", () => {
  it("returns a short time from ISO string", () => {
    const out = formatShortTime("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.match(out, /\d/);
  });

  it("falls back to raw string on parse error", () => {
    const out = formatShortTime("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });
});

describe("formatShortDate", () => {
  it("renders a short date carrying the day-of-month from a fixed epoch", () => {
    const out = formatShortDate(FIXED_EPOCH);
    assert.equal(typeof out, "string");
    assert.match(out, /\b10\b/);
  });
});

describe("formatMonthYear", () => {
  // `FIXED_INSTANT` / `FIXED_EPOCH` come from the top of this file;
  // `FIXED_ISO` is only needed here so it stays local.
  const FIXED_ISO = FIXED_INSTANT.toISOString();

  it("returns a non-empty string from a Date", () => {
    const out = formatMonthYear(FIXED_INSTANT);
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("returns the same string for equivalent Date / epoch ms / ISO inputs", () => {
    // Locale-agnostic structural invariant (Codex #1316): assert
    // that the three input shapes produce identical output for the
    // same instant, not that the output matches a literal year /
    // digit sequence (which would break in non-ASCII-digit or
    // non-Gregorian locales).
    const fromDate = formatMonthYear(FIXED_INSTANT);
    const fromEpoch = formatMonthYear(FIXED_EPOCH);
    const fromIso = formatMonthYear(FIXED_ISO);
    assert.equal(fromEpoch, fromDate);
    assert.equal(fromIso, fromDate);
    assert.ok(fromDate.length > 0);
  });
});
