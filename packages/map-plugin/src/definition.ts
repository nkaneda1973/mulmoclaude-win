// Tool schema. Lives in its own module so both the server entry
// (index.ts) and the browser entry (vue.ts) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// PR-A scope (#1227): only `status` and `configure`. Favorites /
// search / wiki linking land in PR-B / PR-C / PR-D.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageMap" as const,
  description:
    "Configure and inspect the Google Maps integration. " +
    "Use `configure` to store the user's Google Maps API key (entered via Settings) " +
    "and `status` to check whether the plugin is configured before attempting other actions.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["status", "configure"] },
      apiKey: { type: "string", description: "Google Maps API key. Required for kind=configure." },
    },
    required: ["kind"],
  },
};
