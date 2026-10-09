import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./estimates",
  testMatch: "autosave-navigation.local.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: "../.codex-tmp/demo-eight-20261002-01a07773/e2e-results",
  reporter: [["list"], ["html", {
    open: "never", outputFolder: ".codex-tmp/demo-eight-20261002-01a07773/e2e-report",
  }]],
  use: { ...devices["Desktop Chrome"], headless: true, trace: "on", screenshot: "on" },
});
