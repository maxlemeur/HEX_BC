import type { VersionAccessQuery } from "@/lib/estimates/server-context";

export const APPROVAL_VERSION_ACCESS: VersionAccessQuery = {
  mode: "owner_or_approval_reader",
  versionColumns:
    "id, tenant_id, status, updated_at, content_revision, calc_engine_version, calc_snapshot_content_revision, calc_snapshot_context, version_number, project_id, title, date_devis, validite_jours, total_ht_cents, margin_bp, global_coefficient, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, gross_ht_cents, discount_applied_cents, currency, tax_rate_bp, rounding_mode, rounding_step_cents, approval_status, approval_summary, approval_evaluated_at",
  projectColumns: "name, client_name",
};
