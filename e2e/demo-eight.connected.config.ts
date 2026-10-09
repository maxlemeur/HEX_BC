import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.E2E_DEMO_CONNECTED = "1";
process.env.DEMO_EIGHT_RUN_ID ??= `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const runRoot = path.resolve(".e2e/demo-eight-connected", process.env.DEMO_EIGHT_RUN_ID);

export default defineConfig({
  testDir: "./estimates", testMatch: ["demo-eight-*.connected.spec.ts", "column-preferences.spec.ts"],
  fullyParallel: false, workers: 1, retries: 0, timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(runRoot, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(runRoot, "results.json") }]],
  use: {
    ...devices["Desktop Chrome"], baseURL: "http://localhost:3000", headless: true,
    trace: "off", video: "off", screenshot: "off", timezoneId: "Europe/Paris", actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  // Deliberately no storageState, auth bootstrap or webServer.
});
