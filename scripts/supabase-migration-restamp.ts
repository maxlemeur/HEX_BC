import { runSupabaseMigrationRestampCli } from "../src/test/supabase-migration-restamp";

process.exitCode = runSupabaseMigrationRestampCli(process.argv.slice(2));
