import { checkDatabaseTypeSource } from "../src/test/database-types";

try {
  checkDatabaseTypeSource();
  console.log("Generated database types match the pinned CLI, migrations and output receipt.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database type check failed");
  process.exitCode = 1;
}
