import { runProductionBuildSmoke } from "../src/test/production-build-smoke";

runProductionBuildSmoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
