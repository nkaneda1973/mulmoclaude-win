import path from "path";

/**
 * Resolve the directory the production static handler reads `index.html`
 * from.
 *
 * Default (`envValue` unset or empty string): `<baseDir>/../client/`.
 * This is the layout `packages/mulmoclaude/bin/prepare-dist.js`
 * produces when packaging the tarball — `dist/client/` is copied to
 * `<pkg>/client/` so `../client` from `<pkg>/server/` resolves
 * correctly under `npx mulmoclaude`.
 *
 * Override (`envValue` non-empty): the env value is used verbatim.
 * Test spawners (fresh-user smoke specs spawn `tsx server/index.ts`
 * directly without the prepare-dist copy step) set
 * `MULMOCLAUDE_CLIENT_DIR=<repo-root>/dist/client/` so the source-run
 * server can find the SPA bundle. Empty string is treated as
 * "unset" so a shell that exports the var without a value doesn't
 * accidentally break the default.
 *
 * Pure function — both `baseDir` (the caller's `__dirname`) and
 * `envValue` (`process.env.MULMOCLAUDE_CLIENT_DIR`) are passed
 * explicitly so the resolver is unit-testable without mutating
 * `process.env`.
 */
export function resolveClientDir(baseDir: string, envValue: string | undefined): string {
  if (typeof envValue === "string" && envValue.length > 0) {
    return envValue;
  }
  return path.join(baseDir, "../client");
}
