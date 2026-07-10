import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files share a single Postgres database and several suites
    // (e.g. worker + upload) issue blanket deleteMany() calls against the
    // same tables. Running files concurrently races those deletes against
    // each other's FK-referenced rows (Job/Slide), causing intermittent
    // failures. Serialize file execution to keep the shared DB
    // consistent across suites.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
