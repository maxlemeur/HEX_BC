import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./estimates",
  testMatch: "ui-polish.local.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: resolve(".e2e/ui-polish/results"),
  reporter: [["list"], ["html", { open: "never", outputFolder: resolve(".e2e/ui-polish/report") }]],
  use: { ...devices["Desktop Chrome"], trace: "off", screenshot: "on" },
});
