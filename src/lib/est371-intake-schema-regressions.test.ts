import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("EST-371 intake schema regressions", () => {
  const migrationSql = readSql(
    "supabase/migrations/20260306210000_est371_affaire_intake.sql"
  );

  it("creates the intake uploads, documents and events tables", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_intake_uploads/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_intake_documents/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_intake_events/
    );
  });

  it("adds the review queue partial index and project composite indexes", () => {
    expect(migrationSql).toMatch(
      /create index if not exists affaire_intake_documents_tenant_project_created_at_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_intake_documents_project_status_created_at_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_intake_documents_review_queue_idx[\s\S]*where classification_status in \('ambiguous', 'failed'\) or document_kind = 'a_classer'/
    );
  });

  it("enforces owner-or-admin project access through a dedicated helper and strict RLS", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.can_access_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /or \(select public\.has_tenant_role\(p_tenant_id, array\['admin'::public\.tenant_role\]\)\)/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_intake_uploads force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_intake_documents force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_intake_events force row level security;/
    );
  });

  it("creates the dedicated storage bucket with metadata-backed policies", () => {
    expect(migrationSql).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit/);
    expect(migrationSql).toMatch(/'affaire-intake'/);
    expect(migrationSql).toMatch(
      /create policy "Tenant members can insert affaire intake storage"/
    );
    expect(migrationSql).toMatch(
      /d\.storage_path = objects\.name/
    );
  });
});
