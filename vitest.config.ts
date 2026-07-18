import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the renderer TS (ported *-core suites and lib tests).
// The "@" alias matches the WXT-generated tsconfig paths (project root).
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
