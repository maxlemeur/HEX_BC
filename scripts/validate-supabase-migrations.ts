import { inspectSupabaseMigrations } from "../src/test/supabase-migrations";

const inventory = inspectSupabaseMigrations();
if (inventory.errors.length > 0) {
  for (const error of inventory.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Supabase migration history is consistent: ${inventory.files.length} files, ${inventory.versions.length} unique versions.`
  );
}
