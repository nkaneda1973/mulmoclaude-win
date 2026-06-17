import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Isomorphic core: pure TS (no Vue), consumed by BOTH the host server
// (node/tsx) and the host frontend (vite). Dual ESM + CJS so the Docker
// CJS server build can `require` it (the package.json `require` condition
// points at the .cjs artifact). Vue surfaces will be a separate ./vue entry.
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
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
