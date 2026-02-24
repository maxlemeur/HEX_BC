import fs from "node:fs";
import path from "node:path";

import { test as setup } from "@playwright/test";

import { loginWithUi } from "./helpers";

const AUTH_STATE_FILE = path.join(process.cwd(), "e2e/.auth/playwright-user.json");

setup("authenticate user", async ({ page }) => {
  await loginWithUi(page);

  const authDir = path.dirname(AUTH_STATE_FILE);
  fs.mkdirSync(authDir, { recursive: true });

  await page.context().storageState({ path: AUTH_STATE_FILE });
});
