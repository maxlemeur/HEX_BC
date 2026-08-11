import {
  inspectSupabaseMigrations,
  parseSupabaseMigrationList,
  validateAppliedMigrationRows,
} from "../src/test/supabase-migrations";
import { runSupabaseCli } from "../src/test/supabase-cli";

const rootDirectory = process.cwd();
const output = runSupabaseCli(
  ["migration", "list", "--local", "--output-format", "json"],
  { capture: true, rootDirectory }
);

const inventory = inspectSupabaseMigrations(rootDirectory);
const rows = parseSupabaseMigrationList(output);
const errors = [
  ...inventory.errors,
  ...validateAppliedMigrationRows(inventory.versions, rows),
];

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Local database matches ${inventory.versions.length} repository migrations, including the four allowlisted legacy versions that CLI 2.109.1 leaves untracked.`
  );
}
