import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    // Only unit tests under src/. Without this, Vitest also globs `e2e/`, and
    // the Playwright spec there throws ("Playwright Test did not expect
    // test.describe() to be called here") because it needs the Playwright
    // runner, not Vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
