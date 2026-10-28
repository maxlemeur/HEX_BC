import type { Database } from "@/types/database";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-28T10:00:00.123456Z";

export function createEstimateEditorResponseFixture() {
  const version = {
    id: VERSION_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID,
    version_number: 1, status: "draft", title: "Plomberie", exclusions: null,
    calc_engine_version: 3, created_at: NOW, updated_at: NOW,
    date_devis: "2026-10-28", validite_jours: 30, currency: "EUR",
    margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
    discount_mode: "simple", discount_bp: 0, discount_steps: [],
    discount_amount_cents: null, discount_applied_cents: null,
    global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none",
    rounding_step_cents: 1, rounding_adjustment_cents: 0,
    total_ht_cents: 2600, total_tax_cents: 520, total_ttc_cents: 3120,
    sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2,
    gross_ht_cents: null, commercial_rounding_cents: null,
    content_revision: 4, calc_snapshot_content_revision: null,
    calc_snapshot_context: null, approval_status: "not_required",
    approval_summary: {}, approval_evaluated_at: null,
    contractor_role: "general_contractor", max_section_depth: 3,
    parent_version_id: null, variant_label: null, seal_hash: null,
    seal_payload_version: null,
  } satisfies Database["public"]["Tables"]["estimate_versions"]["Row"];
  const item = {
    id: ITEM_ID, tenant_id: TENANT_ID, version_id: VERSION_ID,
    parent_id: null, item_type: "line", position: 1, title: "Tube cuivre",
    description: "Tube cuivre", quantity: 2, unit_price_ht_cents: 1000,
    pu_ht_cents: 1300, tax_rate_bp: 2000, k_fo: 1, k_mo: 1,
    h_mo: 0, h_mo_majoration: 1, h_mo_atelier: null, h_mo_chantier: null,
    k_mo_atelier: null, k_mo_chantier: null, labor_role_id: null,
    labor_role_atelier_id: null, labor_role_chantier_id: null,
    category_id: null, supply_type_id: null, selected_supplier_price_id: null,
    product_id: null, line_nature: "supply_only", fo_provision: 1, aid: null,
    line_total_ht_cents: 2600, line_tax_cents: 520, line_total_ttc_cents: 3120,
    unit_code: "m", pricing_status: "priced", h_mo_per_unit: 0,
    h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null,
    snapshot_fo_ht_cents: null, snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null, snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null, snapshot_mo_ht_cents: null,
    snapshot_pu_ht_cents: null, source_provider: "manual", source_job_id: null,
    source_file_name: null, source_page: null, source_metadata: {},
    created_at: NOW, updated_at: NOW,
  } satisfies Database["public"]["Tables"]["estimate_items"]["Row"];
  return {
    version: { ...version, estimate_projects: { id: PROJECT_ID, name: "Affaire test" } },
    items: [item], categories: [], supply_types: [], labor_roles: [],
    suggestion_rules: [], margin_tiers: [], version_zero_summary: null,
    is_labor_split_enabled: null,
  };
}
