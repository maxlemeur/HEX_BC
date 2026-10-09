import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const phase = process.env.DESLOP_E2E_PHASE === "before" ? "before" : "after";
const artifactRoot = resolve(`.codex-tmp/deslop-20261002/api-e2e-${phase}`);

export default defineConfig({
  testDir: "./deslop",
  testMatch: "client-list.local.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: resolve(artifactRoot, "results"),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: resolve(artifactRoot, "report") }],
    ["json", { outputFile: resolve(artifactRoot, "report.json") }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "on",
    screenshot: "on",
  },
});
