import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "login-helper.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 8_000,
  reporter: "list",
  outputDir: "../../test-results/login-helper",
  use: {
    headless: true,
    trace: "off",
    video: "off",
  },
});
