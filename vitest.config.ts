import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@runtime": resolve(__dirname, "runtime"),
      "@tests": resolve(__dirname, "tests"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // tests use fake clock — keep them ordered
      },
    },
    reporters: process.env.CI ? ["default"] : ["default"],
    // No real network or real clock should ever leak in.
    // Tests must use FakeClock and MockChannel from tests/mocks/.
  },
});
