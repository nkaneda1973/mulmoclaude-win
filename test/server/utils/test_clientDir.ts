import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";

import { resolveClientDir } from "../../../server/utils/clientDir.ts";

// `resolveClientDir` picks between two branches based on the env
// value. Both branches matter to production behaviour:
//
//   - **default** (env unset / empty): the prepared-package layout
//     `bin/prepare-dist.js` produces — `<__dirname>/../client/`.
//     This is what every `npx mulmoclaude` user actually hits.
//   - **override** (env non-empty): test spawners point at
//     `<repo-root>/dist/client/` because the source layout has no
//     `<repo-root>/client/`.
//
// L-FRESH-BOOT covers the override branch end-to-end (the spec
// helper sets MULMOCLAUDE_CLIENT_DIR). The default branch is what
// real users depend on but no integration test exercises it (the
// prepare-dist + tarball + npx flow is too heavy for a per-PR
// run), so the regression net is here: every change to the
// resolver must keep the default path byte-identical to what it
// resolved before MULMOCLAUDE_CLIENT_DIR was introduced.

describe("resolveClientDir", () => {
  const SAMPLE_BASE_DIR = "/abs/repo/server";
  const EXPECTED_DEFAULT = path.join(SAMPLE_BASE_DIR, "../client");

  it("returns the env value verbatim when MULMOCLAUDE_CLIENT_DIR is non-empty", () => {
    assert.equal(resolveClientDir(SAMPLE_BASE_DIR, "/custom/client/dir"), "/custom/client/dir");
  });

  it("falls back to <baseDir>/../client when env is undefined (prepared-package default)", () => {
    // This is the path real `npx mulmoclaude` users hit. Asserting
    // it explicitly catches a regression where someone refactors
    // the resolver and accidentally changes the default — that
    // would silently break every production install while every
    // test (which sets the env) still passes.
    assert.equal(resolveClientDir(SAMPLE_BASE_DIR, undefined), EXPECTED_DEFAULT);
  });

  it("falls back to default when env is empty string", () => {
    // A shell that exports the var without a value (`export X=`)
    // surfaces as `""`. Treating empty as "unset" preserves the
    // prepared-package default rather than 404-ing on the empty
    // path.
    assert.equal(resolveClientDir(SAMPLE_BASE_DIR, ""), EXPECTED_DEFAULT);
  });

  it("uses the env value verbatim even when it points to a relative path", () => {
    // Resolver does NOT resolve to absolute; the caller (express
    // static) will resolve relative paths against cwd. Locked here
    // so a future "auto-absolutize" change is a deliberate decision,
    // not an accidental side-effect.
    assert.equal(resolveClientDir(SAMPLE_BASE_DIR, "./relative/client"), "./relative/client");
  });

  it("uses the env value verbatim when it is whitespace-only", () => {
    // Whitespace-only is unusual but the resolver intentionally
    // checks `length > 0`, not `trim().length > 0`. If a user sets
    // `MULMOCLAUDE_CLIENT_DIR=" "` we trust their intent (and they
    // will get a clear "failed to read index.html" log from the
    // static handler) rather than silently falling back.
    assert.equal(resolveClientDir(SAMPLE_BASE_DIR, " "), " ");
  });
});
