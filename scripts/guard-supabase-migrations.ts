import { runSupabaseMigrationGitGuard } from "../src/test/supabase-migration-git-guard";

const result = runSupabaseMigrationGitGuard();
console.log(
  `Supabase migration Git guard passed (${result.mode}, ${result.changedPaths} scoped changes).`
);
