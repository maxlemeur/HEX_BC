/**
 * A v3 export document frozen by the pure engine (computeEstimateV3Breakdown, projectEstimateV3Snapshot) and prepared
 * as the server prepares it (prepareEstimateV3DocumentData): one priced supply line per entry, in one section, each
 * with its own source_metadata. Fictional values only. Used by the export tests of TI-682 (takeoff provision column).
 */
import { prepareEstimateV3DocumentData, type EstimateItem } from "@/components/estimate-document/prepare-estimate-document-data";
import { computeEstimateV3Breakdown, projectEstimateV3Snapshot } from "@/lib/estimates/engine-v3";
import { fixtureLineId, v3Line, v3Params } from "@/lib/estimates/engine-v3/oracle.fixtures";
import type { EstimateV3ExportDocument } from "@/lib/estimates/v3-export";

export const FIXTURE_TAKEOFF_JOB_ID = "30000000-0000-4000-8000-000000000003";
const FIXTURE_TAKEOFF_ITEM_ID = "40000000-0000-4000-8000-000000000004";

export type FixtureTakeoffSource = {
  forced?: boolean; forced_reason?: string | null; entry_category?: string | null; hypothesis_cause?: string | null;
};

/** source_metadata carrying a version 1 takeoff marker with the given sources (private.takeoff_mark_provisions). */
export function takeoffProvisionMetadata(...sources: FixtureTakeoffSource[]): Record<string, unknown> {
  return {
    takeoff_provision: {
      version: 1,
      job_id: FIXTURE_TAKEOFF_JOB_ID,
      sources: sources.map((source) => ({
        takeoff_item_id: FIXTURE_TAKEOFF_ITEM_ID, forced: false, forced_reason: null, entry_category: null, ...source,
      })),
    },
  };
}

function documentItem(overrides: Partial<EstimateItem>): EstimateItem {
  return {
    aid: null, product_id: null, id: fixtureLineId(1), created_at: "2026-11-11T08:00:00.000Z", updated_at: "2026-11-11T08:00:00.000Z",
    tenant_id: "22222222-2222-4222-8222-222222222222", version_id: "44444444-4444-4444-8444-444444444444", parent_id: null,
    item_type: "line", line_nature: "supply_only", position: 0, title: "Ligne", description: null, quantity: null, unit_price_ht_cents: null,
    tax_rate_bp: 2000, k_fo: 1, fo_price_origin: null, fo_provision: 1, h_mo: null, h_mo_majoration: 1, k_mo: 1, h_mo_atelier: null,
    k_mo_atelier: null, labor_role_atelier_id: null, h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
    pu_ht_cents: null, labor_role_id: null, category_id: null, supply_type_id: null, selected_supplier_price_id: null,
    source_provider: null, source_job_id: null, source_file_name: null, source_page: null, source_metadata: {},
    snapshot_pu_ht_cents: null, snapshot_fo_ht_cents: null, snapshot_mo_ht_cents: null, snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null, line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null, unit_code: null,
    pricing_status: "priced", h_mo_per_unit: null, h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null,
    snapshot_gross_ht_cents: null, snapshot_gross_fo_ht_cents: null, was_not_priced: false, status_reason: null, offer_choice: null,
    ...overrides,
  };
}

/** One fixture line: a priced supply line by default; TI-682 lot C adds an excluded status and its internal reason. */
export type FixtureExportLine = {
  title: string;
  metadata: unknown;
  pricing_status?: EstimateItem["pricing_status"];
  was_not_priced?: boolean;
  status_reason?: unknown;
  offer_choice?: unknown;
};

export function frozenV3ExportDocument(
  lines: ReadonlyArray<FixtureExportLine>,
  options: { laborSplit?: boolean } = {},
): EstimateV3ExportDocument {
  const sectionId = "a0000000-0000-4000-8000-00000000000a";
  const inputs = lines.map((line, index) => v3Line(index + 1, { quantity: 2, unit_price_ht_cents: 1000 + index, unit_code: "u",
    ...(line.pricing_status ? { pricing_status: line.pricing_status } : {}) }));
  const breakdown = computeEstimateV3Breakdown({ params: v3Params({ labor_split_enabled: options.laborSplit === true }), items: inputs });
  const projection = projectEstimateV3Snapshot(breakdown);
  const section = documentItem({ id: sectionId, item_type: "section", line_nature: null, title: "ARMY lot", tax_rate_bp: null });
  const items = [section, ...inputs.map((input, index) => {
    const snapshot = projection.items[index];
    return documentItem({
      id: input.id, parent_id: sectionId, position: index, title: lines[index].title,
      source_metadata: lines[index].metadata as EstimateItem["source_metadata"],
      was_not_priced: lines[index].was_not_priced ?? false,
      status_reason: (lines[index].status_reason ?? null) as EstimateItem["status_reason"],
      offer_choice: (lines[index].offer_choice ?? null) as EstimateItem["offer_choice"],
      quantity: Number(input.quantity), unit_price_ht_cents: Number(input.unit_price_ht_cents), unit_code: "u",
      pricing_status: breakdown.lines[index].pricing_status, tax_rate_bp: breakdown.lines[index].tax_rate_bp,
      pu_ht_cents: snapshot.pu_ht_cents, snapshot_pu_ht_cents: snapshot.snapshot_pu_ht_cents,
      snapshot_gross_ht_cents: snapshot.snapshot_gross_ht_cents, snapshot_gross_fo_ht_cents: snapshot.snapshot_gross_fo_ht_cents,
      line_total_ht_cents: snapshot.line_total_ht_cents, line_tax_cents: snapshot.line_tax_cents,
      line_total_ttc_cents: snapshot.line_total_ttc_cents, snapshot_fo_ht_cents: snapshot.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: snapshot.snapshot_mo_ht_cents, snapshot_mo_atelier_ht_cents: snapshot.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: snapshot.snapshot_mo_chantier_ht_cents,
    });
  })];
  const version = {
    contractor_role: "principal",
    gross_ht_cents: projection.version.gross_ht_cents, discount_applied_cents: projection.version.discount_applied_cents,
    commercial_rounding_cents: projection.version.commercial_rounding_cents, total_ht_cents: projection.version.total_ht_cents,
    total_tax_cents: projection.version.total_tax_cents, total_ttc_cents: projection.version.total_ttc_cents,
    rounding_adjustment_cents: 0, calc_snapshot_context: structuredClone(projection.context),
    discount_bp: projection.version.discount_bp, discount_amount_cents: projection.version.discount_amount_cents, tax_rate_bp: 2000,
    currency: "EUR", status: "draft", date_devis: "2026-11-11", sale_coefficient_fo: 1, sale_coefficient_mo: 1,
  };
  const prepared = prepareEstimateV3DocumentData({ calcEngineVersion: 3, items, version, currency: "EUR", validiteJours: 30 });
  return { version: version as unknown as EstimateV3ExportDocument["version"], items, prepared, frozen: true };
}
