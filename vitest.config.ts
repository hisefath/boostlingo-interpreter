import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is src/client; tests live at the repo root.
export default defineConfig({
  test: { root: ".", include: ["tests/**/*.test.ts"], environment: "node" },
});
