import { requireCriticalE2EEnvironment } from "../src/test/required-environment";

try {
  requireCriticalE2EEnvironment();
  console.log("Critical E2E environment is configured.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
