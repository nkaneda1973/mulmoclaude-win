# map-plugin

MulmoClaude runtime plugin scaffolded with `create-mulmoclaude-plugin`.

The included sample is a counter — one tool (`incrementCounter`)
with three actions (increment / reset / get), persistent state in
`files.data`, pubsub on every mutation, and a Vue View that
reflects changes live across tabs. Use it as a starting point;
rename and reshape as you go.

## Build

```bash
yarn install
yarn build
```

`yarn build` produces `dist/index.js` (server entry) and
`dist/vue.js` (browser entry) plus matching `.d.ts` files.

## Develop against MulmoClaude

For now the smoothest local-development path is `yarn link`:

```bash
# In this plugin directory:
yarn link

# In the mulmoclaude monorepo:
yarn link map-plugin

# Add the plugin to mulmoclaude's preset list (server/plugins/preset-list.ts)
# or install it via the runtime install UI.

yarn dev   # mulmoclaude
```

A first-class "install from local path" workflow is being tracked at
[receptron/mulmoclaude#1159](https://github.com/receptron/mulmoclaude/issues/1159) PR2 / PR3.

When you edit plugin source you need to rebuild
(`yarn build` or `yarn dev` — `vite build --watch`) and ask
mulmoclaude to reload the plugin (restart server is the current
fallback).

## Publish

When the plugin is ready:

```bash
npm publish
```

## Plugin runtime API

This plugin uses the `gui-chat-protocol` v0.3 runtime API:

- `definePlugin(({ runtime }) => ({ TOOL_DEFINITION, [toolName]: handler }))` —
  factory that returns the handler bound to the runtime's destructured
  pieces.
- `runtime.files.data` — persistent JSON / text under
  `~/mulmoclaude/data/plugins/<encoded-pkg>/`. Backup target.
- `runtime.files.config` — per-machine UI prefs.
- `runtime.pubsub.publish(channel, payload)` — broadcast to every
  open tab of mulmoclaude. The View calls `pubsub.subscribe` to
  refresh when mutations land.
- `runtime.log` — structured logging that lands in the host's log
  file.
- Browser side: `useRuntime()` (from `gui-chat-protocol/vue`)
  exposes `pubsub`, `dispatch` (calls back into the server
  handler), `locale`, `openUrl`, and `log`.

The eslint preset (`gui-chat-protocol/eslint-preset`) bans direct
`node:fs` / `node:path` / `console` / `fetch` calls — every
I/O goes through the runtime.

## Layout

```
src/
  index.ts          server: definePlugin factory, persistent state, pubsub
  definition.ts     TOOL_DEFINITION shared between server + browser
  vue.ts            browser: { toolDefinition, viewComponent }
  View.vue          canvas SFC, useRuntime + dispatch + pubsub.subscribe
  shims-vue.d.ts    Vue SFC type shim for tsc
  lang/
    en.ts           translation table
    ja.ts           Japanese translations
    index.ts        useT() composable that reads runtime.locale
```

## License

MIT
