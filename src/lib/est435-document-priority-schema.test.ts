import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("EST-435 document priority schema", () => {
  const migrationSql = readSql(
    "supabase/migrations/20260312113000_est435_document_priority.sql"
  );

  it("adds document_priority with primary/secondary constraints", () => {
    expect(migrationSql).toMatch(/add column if not exists document_priority text not null default 'secondary'/);
    expect(migrationSql).toMatch(/affaire_intake_documents_document_priority_check/);
    expect(migrationSql).toMatch(/document_priority in \('primary', 'secondary'\)/);
    expect(migrationSql).toMatch(/affaire_intake_documents_primary_kind_check/);
  });

  it("enforces a single primary DPGF and CCTP per affaire", () => {
    expect(migrationSql).toMatch(/affaire_intake_documents_project_primary_dpgf_idx/);
    expect(migrationSql).toMatch(/affaire_intake_documents_project_primary_cctp_idx/);
    expect(migrationSql).toMatch(/where document_kind = 'dpgf' and document_priority = 'primary'/);
    expect(migrationSql).toMatch(/where document_kind = 'cctp' and document_priority = 'primary'/);
  });

  it("tracks explicit priority changes in intake events", () => {
    expect(migrationSql).toMatch(/document\.priority_changed/);
  });
});
