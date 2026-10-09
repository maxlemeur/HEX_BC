import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { AUTH_STATE_FILE, POLISH_OUTPUT_DIR } from "./polish/support";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Log in through the UI only when the runner exported E2E credentials; otherwise reuse the
// session already stored in e2e/.auth (the audit never types credentials itself).
const loginFirst = Boolean(process.env.E2E_LOGIN_EMAIL?.trim());

/**
 * Screen-by-screen audit for the UI polish: screenshots at 320/390/768/1440, axe
 * serious/critical, horizontal overflow, visible h1 and blocked writes on shared data.
 * Expects a running app (`npm run dev`); records by default, asserts with POLISH_ASSERT=1.
 */
export default defineConfig({
  globalSetup: path.join(__dirname, "polish", "global-setup.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 420_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(POLISH_OUTPUT_DIR, "playwright"),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(POLISH_OUTPUT_DIR, "html") }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    headless: true,
    contextOptions: { reducedMotion: "reduce" },
    navigationTimeout: 90_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    ...(loginFirst
      ? [
          {
            name: "setup",
            testDir: path.join(__dirname, "estimates"),
            testMatch: /auth\.setup\.ts/,
          },
        ]
      : []),
    {
      name: "polish",
      testDir: path.join(__dirname, "polish"),
      testMatch: /screens\.spec\.ts/,
      dependencies: loginFirst ? ["setup"] : [],
      use: { storageState: AUTH_STATE_FILE },
    },
  ],
});
