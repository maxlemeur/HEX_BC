import { parseLocalSupabaseCiArguments, runLocalSupabaseCi } from "../src/test/local-supabase-ci";

// `npm run db:ci:local -- --files a.test.sql,b.test.sql [--skip-rls]`: a
// partial run; without arguments every pgTAP file and the RLS matrix run.
Promise.resolve()
  .then(() => runLocalSupabaseCi(parseLocalSupabaseCiArguments(process.argv.slice(2))))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
