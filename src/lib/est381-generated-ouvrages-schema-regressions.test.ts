import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-381 generated ouvrages schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260307110000_est381_generated_ouvrages.sql"
    ),
    "utf8"
  );

  it("creates persistent generated ouvrage draft tables with explicit workflow constraints", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_generated_ouvrage_drafts/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_generated_ouvrage_source_fragments/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_generated_ouvrage_candidates/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_generated_ouvrage_candidate_sources/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_generated_ouvrage_applications/
    );
    expect(migrationSql).toMatch(
      /status in \('pending', 'partially_applied', 'applied', 'discarded'\)/
    );
    expect(migrationSql).toMatch(
      /resolution_status in \('pending', 'inserted', 'rejected'\)/
    );
    expect(migrationSql).toMatch(
      /source_kind in \('free_text', 'cctp_excerpt', 'internal_note', 'history', 'library'\)/
    );
  });

  it("indexes project, source document, cctp section and application lookups", () => {
    expect(migrationSql).toMatch(
      /create index if not exists estimate_generated_ouvrage_drafts_project_status_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_generated_ouvrage_source_fragments_project_status_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_generated_ouvrage_source_fragments_source_document_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_generated_ouvrage_source_fragments_cctp_section_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_generated_ouvrage_applications_item_idx/
    );
  });

  it("enforces strict RLS and per-draft ownership on generated ouvrage tables", () => {
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_generated_ouvrage_drafts force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_generated_ouvrage_source_fragments force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_generated_ouvrage_candidates force row level security;/
    );
    expect(migrationSql).toMatch(
      /create policy "Users can insert generated ouvrage drafts"/
    );
    expect(migrationSql).toMatch(
      /create policy "Users can update generated ouvrage candidates"[\s\S]*d\.created_by = \(select auth\.uid\(\)\)/
    );
    expect(migrationSql).toMatch(
      /create policy "Users can insert generated ouvrage applications"[\s\S]*d\.created_by = \(select auth\.uid\(\)\)/
    );
  });

  it("adds audit triggers and generated ouvrage version events", () => {
    expect(migrationSql).toMatch(
      /estimate_generated_ouvrage_drafts_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /estimate_generated_ouvrage_candidates_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /'generated_ouvrage_draft_created',\s*'generated_ouvrage_inserted',\s*'generated_ouvrage_discarded'/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.log_estimate_version_event/
    );
  });
});
