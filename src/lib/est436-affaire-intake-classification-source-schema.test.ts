import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260312143000_est436_affaire_intake_classification_source.sql"
  ),
  "utf8"
);

describe("EST-436 intake classification source schema", () => {
  it("allows explicit heuristic provenance for intake document classification", () => {
    expect(migrationSql).toMatch(
      /drop constraint if exists affaire_intake_documents_classification_source_check/
    );
    expect(migrationSql).toMatch(/classification_source in \('ai', 'heuristic', 'manual'\)/);
  });
});
