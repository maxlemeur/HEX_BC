import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-372 brief schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260306224500_est372_affaire_brief.sql"
    ),
    "utf8"
  );

  it("creates persistent affaire brief tables with typed workflow constraints", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_briefs/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_brief_source_links/
    );
    expect(migrationSql).toMatch(
      /status in \('a_confirmer', 'confirme'\)/
    );
    expect(migrationSql).toMatch(
      /block_key in \(\s*'summary',\s*'project_object',\s*'scope',\s*'lots',\s*'received_pieces',\s*'assumptions',\s*'vigilance_points',\s*'missing_elements'/
    );
  });

  it("adds project, status, review and provenance indexes for the brief", () => {
    expect(migrationSql).toMatch(
      /create index if not exists affaire_briefs_project_status_updated_at_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_briefs_a_confirmer_idx[\s\S]*where status = 'a_confirmer'/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_brief_source_links_source_document_idx/
    );
  });

  it("introduces a read helper that includes directors and keeps strict brief RLS", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /array\['admin'::public\.tenant_role, 'director'::public\.tenant_role\]/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_briefs force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_brief_source_links force row level security;/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire briefs"/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire brief source links"/
    );
  });

  it("extends intake audit events for brief generation, edit and confirmation", () => {
    expect(migrationSql).toMatch(
      /'brief\.generated',\s*'brief\.updated',\s*'brief\.confirmed'/
    );
  });

  it("broadens read-only intake policies to the new read helper", () => {
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire intake uploads"[\s\S]*can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire intake documents"[\s\S]*can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire intake events"[\s\S]*can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant members can view affaire intake storage"[\s\S]*can_read_affaire_intake_project/
    );
  });
});
