import fs from "node:fs";
import path from "node:path";

import { computeSupabaseMigrationHashes } from "../src/test/supabase-migrations";

const rootDirectory = process.cwd();
const manifestPath = path.join(
  rootDirectory,
  "supabase",
  "migrations.manifest.json"
);
const currentHashes = computeSupabaseMigrationHashes(rootDirectory);
const existing = fs.existsSync(manifestPath)
  ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      algorithm?: string;
      migrations?: Record<string, string>;
    })
  : { algorithm: "sha256", migrations: {} };

if (existing.algorithm !== "sha256" || !existing.migrations) {
  throw new Error("Existing migration manifest is invalid");
}

for (const [fileName, hash] of Object.entries(existing.migrations)) {
  if (!currentHashes[fileName]) {
    throw new Error(`Manifest migration was deleted: ${fileName}`);
  }
  if (currentHashes[fileName] !== hash) {
    throw new Error(`Refusing to update the hash of a deployed migration: ${fileName}`);
  }
}

const migrations = Object.fromEntries(
  Object.entries({ ...existing.migrations, ...currentHashes }).sort(([left], [right]) =>
    left.localeCompare(right)
  )
);
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({ algorithm: "sha256", migrations }, null, 2)}\n`,
  "utf8"
);
console.log(
  `Supabase migration manifest contains ${Object.keys(migrations).length} immutable entries.`
);
