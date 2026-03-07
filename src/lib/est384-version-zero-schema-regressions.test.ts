import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-384 version zero schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260307201500_est384_version_zero_drafts.sql"
    ),
    "utf8"
  );

  it("creates persistent version zero draft tables with explicit review workflow constraints", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_version_zero_drafts/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_version_zero_lots/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_version_zero_lines/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.estimate_version_zero_applications/
    );
    expect(migrationSql).toMatch(
      /status in \('ia_a_revoir', 'ready_for_version', 'materialized', 'discarded', 'superseded'\)/
    );
    expect(migrationSql).toMatch(
      /status in \('generated', 'partial', 'missing'\)/
    );
    expect(migrationSql).toMatch(
      /review_status in \('pending', 'accepted', 'edited', 'rejected'\)/
    );
    expect(migrationSql).toMatch(
      /jsonb_typeof\(facts\) = 'array'/
    );
    expect(migrationSql).toMatch(
      /jsonb_typeof\(hypotheses\) = 'array'/
    );
    expect(migrationSql).toMatch(
      /jsonb_typeof\(inferences\) = 'array'/
    );
  });

  it("adds the required draft, version and review indexes including the ia_a_revoir partial index", () => {
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_drafts_project_status_created_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_drafts_version_created_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_drafts_ia_a_revoir_idx[\s\S]*where status = 'ia_a_revoir'/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_lines_version_review_status_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_lines_project_review_status_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists estimate_version_zero_applications_version_item_idx/
    );
  });

  it("wires tenant scope triggers, strict RLS, and estimate audit triggers on every version zero table", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.assign_estimate_version_zero_draft_scope/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.assign_estimate_version_zero_lot_scope/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.assign_estimate_version_zero_line_scope/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.assign_estimate_version_zero_application_scope/
    );
    expect(migrationSql).toMatch(
      /create trigger set_estimate_version_zero_drafts_updated_at/
    );
    expect(migrationSql).toMatch(
      /create trigger set_estimate_version_zero_lines_scope/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_version_zero_drafts force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_version_zero_lots force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_version_zero_lines force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_version_zero_applications force row level security;/
    );
    expect(migrationSql).toMatch(
      /create policy "Users can insert version zero drafts"[\s\S]*created_by = \(select auth\.uid\(\)\)/
    );
    expect(migrationSql).toMatch(
      /create policy "Users can update version zero lines"[\s\S]*d\.created_by = \(select auth\.uid\(\)\)/
    );
    expect(migrationSql).toMatch(
      /estimate_version_zero_drafts_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /estimate_version_zero_lots_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /estimate_version_zero_lines_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /estimate_version_zero_applications_audit_trigger/
    );
    expect(migrationSql).toMatch(
      /for each row execute procedure public\.log_estimate_audit\(\);/
    );
  });
});
