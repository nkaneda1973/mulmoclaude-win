// Dependency-free home for the Docker sandbox workspace mount path.
//
// Lives in its own leaf module (no imports) so that lightweight callers
// — e.g. the e2e-live test fixtures — can import this single constant
// without dragging in `config.ts`'s heavy module graph (mcp-tools,
// stdio shim, @mulmobridge/* packages, …). `config.ts` re-exports it
// for back-compat with existing importers.

/** Absolute path the host workspace is bind-mounted at inside the Docker sandbox. */
export const CONTAINER_WORKSPACE_PATH = "/home/node/mulmoclaude";
