// Tool schema. Lives in its own module so both the server entry
// (index.ts) and the browser entry (vue.ts) can import it without
// dragging in the factory body, Zod, or any other server-only code.
//
// PR-A: status, configure.
// PR-B: addFavorite, listFavorites, removeFavorite, getApiKey.
// Places search + wiki coords linking land in PR-C / PR-D.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageMap" as const,
  description:
    "Manage saved places (favorites) on a Google Map. " +
    "`addFavorite` saves a name + lat/lng with optional tags; " +
    "`listFavorites` returns every saved place; " +
    "`removeFavorite` deletes by id. " +
    "`status` returns whether the API key is configured; " +
    "`configure` stores a new key (entered via Settings, not by the LLM); " +
    "`getApiKey` returns the configured key for the in-process Vue View " +
    "to bootstrap the Maps JS SDK (never call this from the LLM).",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["status", "configure", "getApiKey", "addFavorite", "listFavorites", "removeFavorite"] },
      // configure
      apiKey: { type: "string", description: "Google Maps API key. Required for kind=configure." },
      // addFavorite
      name: { type: "string", description: "Display name for the favorite. Required for kind=addFavorite." },
      lat: { type: "number", description: "Latitude in WGS84 decimal degrees, between -90 and 90. Required for kind=addFavorite." },
      lng: { type: "number", description: "Longitude in WGS84 decimal degrees, between -180 and 180. Required for kind=addFavorite." },
      placeId: { type: "string", description: "Google Places place_id (optional, for re-fetching photos / hours)." },
      tags: { type: "array", items: { type: "string" }, description: "Free-form labels for filtering, e.g. ['food', 'tokyo']." },
      notes: { type: "string", description: "Free-form notes shown in the detail panel." },
      // removeFavorite
      id: { type: "string", description: "Favorite UUID. Required for kind=removeFavorite." },
    },
    required: ["kind"],
  },
};
