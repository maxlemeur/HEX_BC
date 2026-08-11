import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function resolveWebServer() {
  if (
    process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "1" ||
    process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "true"
  ) {
    return undefined;
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseURL);
  } catch {
    return undefined;
  }

  const isLocalHost = ["localhost", "127.0.0.1"].includes(parsedBaseUrl.hostname);
  if (!isLocalHost) {
    return undefined;
  }

  const port = parsedBaseUrl.port || "3000";

  return {
    command: `npm run dev -- --port ${port}`,
    env: {
      TAKEOFF_MODULE_ENABLED_BY_DEFAULT: "1",
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  };
}

export default defineConfig({
  testDir: "./e2e/estimates",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results/playwright",
  use: {
    baseURL,
    trace: process.env.CI ? "off" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: process.env.E2E_HEADED === "1" ? false : true,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/playwright-user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "chromium-critical",
      testMatch: [
        /dashboard-ux\.spec\.ts/,
        /duplicate\.spec\.ts/,
        /full-lifecycle\.spec\.ts/,
        /hub-launch-metre\.spec\.ts/,
        /import-dpgf\.spec\.ts/,
        /plan-center\.spec\.ts/,
        /team-a-hub-prod\.spec\.ts/,
      ],
      testIgnore: /team-a-hub-dev-scenarios\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/playwright-user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: resolveWebServer(),
});
