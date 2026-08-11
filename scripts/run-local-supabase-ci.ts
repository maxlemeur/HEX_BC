import { runLocalSupabaseCi } from "../src/test/local-supabase-ci";

runLocalSupabaseCi().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
