import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Keeps every test away from the real tenant registry.
    setupFiles: ["tests/setup-env.ts"],
    environment: "node",
    coverage: {
      provider: "v8"
    }
  }
});
