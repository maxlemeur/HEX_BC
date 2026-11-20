import type { Database } from "@/types/database";

/**
 * A fictional estimate sent when its labour role cost 12,00 €/h. One line: 2 units of supply at
 * 50,00 € and 2 hours of labour, margin ×1,2. Frozen when sent: cost 124,00 €, sale 148,80 € HT
 * (PU 74,40 €), VAT 20 % 29,76 €, 178,56 € TTC. The tenant has since raised the role to 15,00 €/h:
 * recalculated today, the same line costs 130,00 € and sells 156,00 € HT. Priced by engine 1, or by
 * engine 2, whose line also stores its sale split (FO 120,00 €, MO 28,80 €).
 */
export const SENT_ESTIMATE_IDS = {
  tenant: "a1000000-0000-4000-8000-000000000001",
  user: "a1000000-0000-4000-8000-000000000002",
  project: "a1000000-0000-4000-8000-000000000003",
  version: "a1000000-0000-4000-8000-000000000004",
  line: "a1000000-0000-4000-8000-000000000005",
  laborRole: "a1000000-0000-4000-8000-000000000006",
} as const;

const NOW = "2026-11-20T09:00:00.000000Z";

export const SENT_ESTIMATE_STORED = { htCents: 14_880, taxCents: 2_976, ttcCents: 17_856, unitPriceCents: 7_440 };
export const SENT_ESTIMATE_LIVE_HT_CENTS = 15_600;

export const SENT_ESTIMATE_PROJECT = {
  id: SENT_ESTIMATE_IDS.project,
  tenant_id: SENT_ESTIMATE_IDS.tenant,
  user_id: SENT_ESTIMATE_IDS.user,
  name: "Affaire fictive",
  reference: "FICT/2026",
  estimate_reference: "FICT_D26001",
  site_address: "1 rue Imaginaire\n00000 Nulle-Part",
  client_name: "Client fictif",
  notes: null,
  is_archived: false,
};

export const SENT_ENGINE_1_VERSION = {
  id: SENT_ESTIMATE_IDS.version, tenant_id: SENT_ESTIMATE_IDS.tenant, project_id: SENT_ESTIMATE_IDS.project,
  version_number: 3, status: "sent", title: "Cloisons", exclusions: null,
  calc_engine_version: 1, created_at: NOW, updated_at: NOW,
  date_devis: "2026-11-02", validite_jours: 30, currency: "EUR",
  margin_mode: "fixed", margin_multiplier: 1.2, margin_bp: 1667,
  discount_mode: "simple", discount_bp: 0, discount_steps: [],
  discount_amount_cents: null, discount_applied_cents: null,
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none",
  rounding_step_cents: 0, rounding_adjustment_cents: 0,
  total_ht_cents: SENT_ESTIMATE_STORED.htCents,
  total_tax_cents: SENT_ESTIMATE_STORED.taxCents,
  total_ttc_cents: SENT_ESTIMATE_STORED.ttcCents,
  sale_coefficient_fo: null, sale_coefficient_mo: null,
  gross_ht_cents: null, commercial_rounding_cents: null,
  content_revision: 4, calc_snapshot_content_revision: null,
  calc_snapshot_context: null, approval_status: "not_required",
  approval_summary: {}, approval_evaluated_at: null,
  contractor_role: "general_contractor", max_section_depth: 3,
  parent_version_id: null, variant_label: null, seal_hash: null,
  seal_payload_version: null,
} satisfies Database["public"]["Tables"]["estimate_versions"]["Row"];

export const SENT_ENGINE_1_LINE = {
  id: SENT_ESTIMATE_IDS.line, tenant_id: SENT_ESTIMATE_IDS.tenant, version_id: SENT_ESTIMATE_IDS.version,
  parent_id: null, item_type: "line", position: 1, title: "Cloison fictive",
  description: "u", quantity: 2, unit_price_ht_cents: 5000,
  pu_ht_cents: SENT_ESTIMATE_STORED.unitPriceCents, tax_rate_bp: 2000, k_fo: 1, k_mo: 1,
  h_mo: 2, h_mo_majoration: 1, h_mo_atelier: null, h_mo_chantier: null,
  k_mo_atelier: null, k_mo_chantier: null, labor_role_id: SENT_ESTIMATE_IDS.laborRole,
  labor_role_atelier_id: null, labor_role_chantier_id: null,
  category_id: null, supply_type_id: null, selected_supplier_price_id: null,
  product_id: null, line_nature: "supply_and_labor", fo_price_origin: null, fo_provision: 1, aid: null,
  status_reason: null, was_not_priced: false, offer_choice: null,
  line_total_ht_cents: SENT_ESTIMATE_STORED.htCents,
  line_tax_cents: SENT_ESTIMATE_STORED.taxCents,
  line_total_ttc_cents: SENT_ESTIMATE_STORED.ttcCents,
  unit_code: null, pricing_status: "priced", h_mo_per_unit: null,
  h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null,
  snapshot_fo_ht_cents: null, snapshot_gross_fo_ht_cents: null,
  snapshot_gross_ht_cents: null, snapshot_mo_atelier_ht_cents: null,
  snapshot_mo_chantier_ht_cents: null, snapshot_mo_ht_cents: null,
  snapshot_pu_ht_cents: null, source_provider: "manual", source_job_id: null,
  source_file_name: null, source_page: null, source_metadata: {},
  created_at: NOW, updated_at: NOW,
} satisfies Database["public"]["Tables"]["estimate_items"]["Row"];

/** Engine 2 sent before its version carried a snapshot revision: frozen because it is no longer a draft. */
export const SENT_ENGINE_2_VERSION = {
  ...SENT_ENGINE_1_VERSION, calc_engine_version: 2,
} satisfies Database["public"]["Tables"]["estimate_versions"]["Row"];

export const SENT_ENGINE_2_LINE = {
  ...SENT_ENGINE_1_LINE,
  snapshot_pu_ht_cents: SENT_ESTIMATE_STORED.unitPriceCents,
  snapshot_fo_ht_cents: 12_000,
  snapshot_mo_ht_cents: 2_880,
} satisfies Database["public"]["Tables"]["estimate_items"]["Row"];

/** The role as the tenant has it today, after the estimate was sent. */
export const TODAY_LABOR_ROLE = {
  id: SENT_ESTIMATE_IDS.laborRole, tenant_id: SENT_ESTIMATE_IDS.tenant, user_id: SENT_ESTIMATE_IDS.user,
  name: "Poseur fictif", hourly_rate_cents: 1500, is_active: true, position: 1, created_at: NOW, updated_at: NOW,
} satisfies Database["public"]["Tables"]["labor_roles"]["Row"];
