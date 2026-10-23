import assert from "node:assert/strict";

import { databaseTypeSource, generateLocalDatabaseTypes, writeDatabaseTypes } from "../src/test/database-types";
import { runLocalSupabaseCi } from "../src/test/local-supabase-ci";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--write") throw new Error("Use npm run supabase:types (owned local schema only)");
  const source = databaseTypeSource();
  let artifact: string | undefined;
  await runLocalSupabaseCi({
    verifyDatabaseTypes(workdir) {
      const first = generateLocalDatabaseTypes(workdir);
      assert.equal(generateLocalDatabaseTypes(workdir), first, "Local type generation is not deterministic");
      artifact = first;
    },
  });
  assert.deepEqual(databaseTypeSource(), source, "Schema inputs changed during type generation");
  assert(artifact, "Local schema was not generated");
  // Publish only after SQL/RLS and owned-stack cleanup have both succeeded.
  writeDatabaseTypes(artifact);
  console.log("Database types generated from the migrated owned stack; SQL/RLS and cleanup passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database type generation failed");
  process.exitCode = 1;
});
