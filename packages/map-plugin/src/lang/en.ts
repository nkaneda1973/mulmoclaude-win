// Plugin-local i18n. Function-form entries take a `{ named }` arg
// per vue-i18n / runtime convention so placeholders like `{count}`
// render correctly.

interface NamedFn {
  named: (key: string) => unknown;
}

export default {
  title: "Map",
  loading: "Loading…",
  configurePrompt: "Set your Google Maps API key in Settings to enable the map.",
  configureHint: "Open Settings → Map and paste a Maps JavaScript API key. The key is stored locally in this workspace only.",
  emptyHint: "Right-click anywhere on the map to save it as a favorite.",
  favoritesCount: ({ named }: NamedFn) => `${String(named("count"))} favorite${Number(named("count")) === 1 ? "" : "s"}`,
  allTagsChip: "All",
  closeDetail: "Close",
  removeFavorite: "Remove",
  addPromptName: "Name this place",
  addPromptTags: "Tags (comma-separated, optional)",
  previewSaved: ({ named }: NamedFn) => `Saved ${String(named("name"))}`,
};
