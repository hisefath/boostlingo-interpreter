import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/eval/": "http://localhost:8787", // trailing slash: must not catch /eval.ts
      "/cascade": { target: "ws://localhost:8787", ws: true },
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    // three pages, absolute paths so the build works from any cwd
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "src/client/index.html"),
        architecture: resolve(import.meta.dirname, "src/client/architecture.html"),
        "system-demo": resolve(import.meta.dirname, "src/client/system-demo.html"),
      },
    },
  },
});
