import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // API route tests exercise the pipeline's own logic (validation, merge,
    // ranking, dating), not the live web. Hitting the real network per person
    // made them slow and timing-dependent, producing a flake that looked like
    // a product defect. Consented-text capture still runs, so pasted profile
    // text is read exactly as in production.
    env: {
      AGENTS_DATE_TEST_NO_NETWORK: "1",
    },
  },
});
