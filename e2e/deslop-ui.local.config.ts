import { defineConfig, devices } from "@playwright/test";

const beforeFix = process.env.DESLOP_UI_PHASE === "before";

export default defineConfig({
  testDir: "./deslop-ui",
  testMatch: "live-replacements.local.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: beforeFix
    ? "../.codex-tmp/deslop-20261002/ui-e2e-before-results"
    : "../.codex-tmp/deslop-20261002/ui-results",
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: beforeFix
        ? "../.codex-tmp/deslop-20261002/ui-e2e-before"
        : "../.codex-tmp/deslop-20261002/ui-report",
    }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    headless: true,
    contextOptions: { reducedMotion: "reduce" },
    trace: "on",
    screenshot: "on",
  },
});
