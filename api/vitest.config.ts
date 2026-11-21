import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
