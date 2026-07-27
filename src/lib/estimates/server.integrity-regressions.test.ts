import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverSource = readFileSync(
  join(process.cwd(), "src/lib/estimates/server.ts"),
  "utf8"
);
const integrityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727020000_estimate_version_integrity.sql"
  ),
  "utf8"
);
const approvalRevisionMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql"
  ),
  "utf8"
);

describe("estimate version integrity regressions", () => {
  it("loads the contractor role and applies reverse-charge VAT during authoritative recalculation", () => {
    const recalculateSource = serverSource.match(
      /async function recalculateEstimateVersionTotals[\s\S]*?\n}\n\nfunction resolveEmbeddedOne/
    )?.[0];

    expect(recalculateSource).toBeDefined();
    expect(recalculateSource).toMatch(
      /\.select\(\s*"[^"]*contractor_role[^"]*estimate_projects!inner\(user_id\)"/
    );
    expect(recalculateSource).toMatch(
      /vatReverseCharge:\s*effectiveVersionRecord\.contractor_role === "subcontractor"/
    );
  });

  it("keeps the calculation engine and contractor role when duplicating a version", () => {
    expect(integrityMigration).toMatch(
      /rounding_step_cents,\s*calc_engine_version,\s*contractor_role,\s*total_ht_cents/
    );
    expect(integrityMigration).toMatch(
      /source_version\.rounding_step_cents,\s*source_version\.calc_engine_version,\s*source_version\.contractor_role,\s*source_version\.total_ht_cents/
    );
  });

  it("duplicates exclusions in the same atomic version insert and keeps the server return contract", () => {
    expect(integrityMigration).toMatch(
      /status,\s*title,\s*exclusions,\s*date_devis/
    );
    expect(integrityMigration).toMatch(
      /'draft',\s*source_version\.title,\s*source_version\.exclusions,\s*source_version\.date_devis/
    );

    const duplicateSource = serverSource.match(
      /export async function duplicateEstimateVersion[\s\S]*?\n}\n\nasync function duplicateSectionInternal/
    )?.[0];
    expect(duplicateSource).toBeDefined();
    expect(duplicateSource).not.toContain('.select("exclusions")');
    expect(duplicateSource).not.toContain(
      ".update({ exclusions: sourceVersion.exclusions })"
    );
    expect(duplicateSource).toMatch(
      /return \{\s*version_id: duplicatedVersionId,\s*\};/
    );
  });

  it("preserves every canonical readonly column and adds both contractual settings", () => {
    const readonlyGuard = integrityMigration.match(
      /create or replace function public\.guard_estimate_versions_readonly\(\)[\s\S]*?\n\$\$;/
    )?.[0];
    expect(readonlyGuard).toBeDefined();
    expect(readonlyGuard).toContain("if new.status = old.status then");

    const canonicalReadonlyColumns = [
      "created_at",
      "tenant_id",
      "project_id",
      "version_number",
      "title",
      "exclusions",
      "date_devis",
      "validite_jours",
      "margin_multiplier",
      "margin_mode",
      "currency",
      "margin_bp",
      "discount_bp",
      "discount_mode",
      "discount_steps",
      "global_coefficient",
      "max_section_depth",
      "tax_rate_bp",
      "rounding_mode",
      "rounding_step_cents",
      "total_ht_cents",
      "total_tax_cents",
      "total_ttc_cents",
      "seal_hash",
      "parent_version_id",
      "variant_label",
      "calc_engine_version",
      "contractor_role",
    ];
    canonicalReadonlyColumns.forEach((column) => {
      expect(readonlyGuard).toContain(
        `new.${column} is distinct from old.${column}`
      );
    });
  });

  it("preserves the latest workflow revision columns and adds exclusions, engine and role", () => {
    const previousWorkflowGuard = approvalRevisionMigration.match(
      /create or replace function public\.guard_estimate_version_workflow_columns\(\)[\s\S]*?\n\$\$;/
    )?.[0];
    const currentWorkflowGuard = integrityMigration.match(
      /create or replace function public\.guard_estimate_version_workflow_columns\(\)[\s\S]*?\n\$\$;/
    )?.[0];
    expect(previousWorkflowGuard).toBeDefined();
    expect(currentWorkflowGuard).toBeDefined();

    const previousColumns = Array.from(
      previousWorkflowGuard?.matchAll(
        /new\.([a-z_]+) is distinct from old\.\1/g
      ) ?? [],
      (match) => match[1]
    );
    previousColumns.forEach((column) => {
      expect(currentWorkflowGuard).toContain(
        `new.${column} is distinct from old.${column}`
      );
    });
    ["exclusions", "calc_engine_version", "contractor_role"].forEach(
      (column) => {
        expect(currentWorkflowGuard).toContain(
          `new.${column} is distinct from old.${column}`
        );
      }
    );
    expect(currentWorkflowGuard).toContain(
      "new.content_revision := old.content_revision + 1"
    );
    expect(approvalRevisionMigration).toMatch(
      /current_content_revision <> cycle_row\.requested_content_revision[\s\S]*message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE'/
    );
    expect(approvalRevisionMigration).toMatch(
      /approved_content_revision = case[\s\S]*then current_content_revision/
    );
  });

  it("patches contractor-role lines and version totals in one protected RPC", () => {
    const rpc = integrityMigration.match(
      /create or replace function public\.patch_estimate_contractor_role\([\s\S]*?\n\$\$;/
    )?.[0];
    expect(rpc).toBeDefined();
    expect(rpc).toContain("for update of version");
    expect(rpc).toMatch(
      /join public\.tenants tenant\s+on tenant\.id = version\.tenant_id\s+and tenant\.is_active/
    );
    expect(rpc).toContain("membership.role in");
    expect(rpc).toContain("'engineer'::public.tenant_role");
    expect(rpc).toContain("lock.expires_at > now()");
    expect(rpc).toContain(
      "target_version.updated_at is distinct from p_expected_updated_at"
    );
    expect(rpc).toContain("update public.estimate_items item");
    expect(rpc).toContain("line_tax_cents = case");
    expect(rpc).toContain("line_total_ttc_cents = case");
    expect(rpc).toContain("update public.estimate_versions version");
    expect(integrityMigration).toMatch(
      /revoke all on function public\.patch_estimate_contractor_role\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.patch_estimate_contractor_role\([\s\S]*to service_role;/
    );
  });

  it("preserves hierarchy ordering and takeoff carry-over in the replaced duplicate RPC", () => {
    expect(integrityMigration).toMatch(
      /with recursive source_item_hierarchy[\s\S]*order by hierarchy\.depth asc, src\.position asc, src\.id asc;/
    );
    expect(integrityMigration).toMatch(
      /insert into public\.takeoff_version_links[\s\S]*insert into public\.takeoff_dpgf_review_decisions/
    );
  });
});
