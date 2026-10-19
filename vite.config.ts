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
    // two pages; paths are relative to root (src/client)
    rollupOptions: { input: { main: "index.html", architecture: "architecture.html" } },
  },
});
