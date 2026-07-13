import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function readProjectFile(path: string) {
  return readFile(join(ROOT, path), "utf8");
}

describe("estimate AI generation budget security", () => {
  it("claims each route operation before its first possible Gemini fan-out", async () => {
    const [structureSource, versionZeroSource] = await Promise.all([
      readProjectFile("src/lib/estimates/structure-drafts.ts"),
      readProjectFile("src/lib/estimates/version-zero-drafts.ts"),
    ]);

    const structureClaim = structureSource.indexOf(
      'operation: "structure_draft"',
      structureSource.indexOf("export async function generateEstimateStructureDraft")
    );
    const structureProvider = structureSource.indexOf(
      "buildDraftNodesFromSources({",
      structureClaim
    );
    expect(structureClaim).toBeGreaterThan(0);
    expect(structureProvider).toBeGreaterThan(structureClaim);

    const versionZeroClaim = versionZeroSource.indexOf(
      'operation: "version_zero_draft"',
      versionZeroSource.indexOf("export async function generateVersionZeroDraft")
    );
    const nestedStructureCall = versionZeroSource.indexOf(
      "generateEstimateStructureDraft(",
      versionZeroClaim
    );
    const versionZeroProvider = versionZeroSource.indexOf(
      "tryGenerateGeminiLots({",
      versionZeroClaim
    );
    expect(versionZeroClaim).toBeGreaterThan(0);
    expect(nestedStructureCall).toBeGreaterThan(versionZeroClaim);
    expect(versionZeroProvider).toBeGreaterThan(versionZeroClaim);
  });

  it("keeps retries within the claimed operation budget", async () => {
    const [structureSource, versionZeroSource] = await Promise.all([
      readProjectFile("src/lib/estimates/structure-drafts.ts"),
      readProjectFile("src/lib/estimates/version-zero-drafts.ts"),
    ]);

    expect(structureSource).toMatch(
      /callGeminiStructured<EstimateStructureGeminiExchange>\(\{[\s\S]*?maxRetries: 0,/
    );
    expect(versionZeroSource).toMatch(
      /callGeminiStructured\(\{[\s\S]*?maxRetries: 0,/
    );
  });

  it("enforces an atomic tenant/version/operation lease in PostgreSQL", async () => {
    const migration = await readProjectFile(
      "supabase/migrations/20260713142735_harden_estimate_ai_generation_budgets.sql"
    );

    expect(migration).toContain(
      "primary key (tenant_id, version_id, operation)"
    );
    expect(migration).toContain(
      "on conflict (tenant_id, version_id, operation) do update"
    );
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("v_active_tenant_windows >= 4");
    expect(migration).toContain("v_active_user_windows >= 2");
    expect(migration).toContain(
      "estimate_ai_generation_budgets.window_expires_at <= v_now"
    );
    expect(migration).toContain(
      "estimate_ai_generation_budgets.lease_expires_at <= v_now"
    );
    expect(migration).toContain(
      "alter table public.estimate_ai_generation_budgets force row level security"
    );
    expect(migration).toMatch(/security definer\nset search_path = ''/g);
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("tm.role in ('admin'::public.tenant_role");
    expect(migration).toContain("dl.expires_at > v_now");
    expect(migration).toContain(
      "revoke all on table public.estimate_ai_generation_budgets from authenticated"
    );
  });
});
