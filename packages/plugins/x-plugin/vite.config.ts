import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only plugin: one entry, no Vue. Mirrors edgar-plugin's build.
// Unlike sandboxed runtime plugins, this package is imported directly by
// the host server build (like @mulmoclaude/{form,markdown}-plugin), so it
// may use global `fetch` and `process.env` freely. Node built-ins are
// externalized; there are no other runtime deps to bundle.
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    minify: false,
    sourcemap: true,
  },
});
