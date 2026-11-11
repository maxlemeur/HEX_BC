import { describe, expect, it } from "vitest";

import { enrichEstimateItemsWithGeneratedOuvrageProvenance } from "@/lib/estimates/generated-ouvrage-provenance";
import { enrichEstimateItemsWithAiStructureProvenance } from "@/lib/estimates/structure-drafts";
import { readTakeoffProvision, takeoffProvisionExportLabel } from "@/lib/estimates/takeoff-provision";
import { takeoffProvisionMetadata } from "@/lib/estimates/v3-export-document.fixtures";

// TI-682 lot C, PR 1 (review finding): the editor reads its lines through GET /api/estimates/{id}, whose provenance
// enrichment rewrites source_metadata for a line created by an AI structure or a generated ouvrage. A takeoff apply can
// later link a forced or hypothesis source onto such a line (private.takeoff_mark_provisions, p_item_links): the row
// carries the marker, and the v1/v2 editor CSV and the line truth must still read it after the enrichment.

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "c4000000-0000-4000-8000-000000000401";

/** Each table answers its rows to any select, filter, order or range (a complete, exact count). */
function tables(rowsByTable: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = rowsByTable[table] ?? [];
      const result = { data: rows, error: null, count: rows.length };
      const builder: object = new Proxy({}, {
        get(_target, property) {
          if (property === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return () => builder;
        },
      });
      return builder;
    },
  } as never;
}

function line(sourceMetadata: Record<string, unknown>) {
  return { id: ITEM_ID, tenant_id: TENANT_ID, version_id: VERSION_ID, item_type: "line", title: "Tube cuivre fictif",
    source_file_name: null, source_page: null, source_metadata: sourceMetadata } as never;
}

const MARKERS = [
  ["forced", takeoffProvisionMetadata({ forced: true, forced_reason: "additional_evidence" }), "Provision interne"],
  ["hypothesis", takeoffProvisionMetadata({ entry_category: "hypothesis" }), "Hypothèse"],
] as const;

describe("provenance enrichment keeps the takeoff marker of a line (TI-682)", () => {
  it.each(MARKERS)("AI structure provenance keeps a %s marker", async (_kind, metadata, label) => {
    const [enriched] = await enrichEstimateItemsWithAiStructureProvenance({
      supabase: tables({
        estimate_structure_draft_nodes: [{ id: "node-1", label: "Réseau fictif", hierarchy_level: 2, confidence: 0.8 }],
        estimate_structure_drafts: [{ id: "draft-1", created_at: "2026-11-11T08:00:00.000Z", generation_metadata: {} }],
      }),
      tenantId: TENANT_ID,
      versionId: VERSION_ID,
      items: [line({ ...metadata, kind: "previous" })],
      versionApplications: Promise.resolve({ data: [{ id: "application-1", draft_id: "draft-1", draft_node_id: "node-1",
        estimate_item_id: ITEM_ID, applied_action: "create", created_at: "2026-11-11T08:00:00.000Z" }], error: null, count: 1 }) as never,
    });
    const sourceMetadata = (enriched as { source_metadata: Record<string, unknown> }).source_metadata;
    expect(sourceMetadata).toMatchObject({ kind: "ai_structure", application_count: 1 });
    expect(readTakeoffProvision(sourceMetadata)).toEqual(readTakeoffProvision(metadata));
    expect(takeoffProvisionExportLabel(sourceMetadata)).toBe(label);
  });

  it.each(MARKERS)("generated ouvrage provenance keeps a %s marker", async (_kind, metadata, label) => {
    const [enriched] = await enrichEstimateItemsWithGeneratedOuvrageProvenance({
      supabase: tables({}),
      tenantId: TENANT_ID,
      versionId: VERSION_ID,
      items: [line({ ...metadata, kind: "previous" })],
      versionApplications: Promise.resolve({ data: [{ id: "application-1", draft_id: "draft-1", candidate_id: "candidate-1",
        estimate_item_id: ITEM_ID, applied_payload: {}, created_at: "2026-11-11T08:00:00.000Z" }], error: null, count: 1 }) as never,
    });
    const sourceMetadata = (enriched as { source_metadata: Record<string, unknown> }).source_metadata;
    expect(sourceMetadata).toMatchObject({ kind: "generated_ouvrage", application_id: "application-1" });
    expect(readTakeoffProvision(sourceMetadata)).toEqual(readTakeoffProvision(metadata));
    expect(takeoffProvisionExportLabel(sourceMetadata)).toBe(label);
  });

  it("adds no marker to an enriched line that had none", async () => {
    const [enriched] = await enrichEstimateItemsWithGeneratedOuvrageProvenance({
      supabase: tables({}),
      tenantId: TENANT_ID,
      versionId: VERSION_ID,
      items: [line({})],
      versionApplications: Promise.resolve({ data: [{ id: "application-1", draft_id: "draft-1", candidate_id: "candidate-1",
        estimate_item_id: ITEM_ID, applied_payload: {}, created_at: "2026-11-11T08:00:00.000Z" }], error: null, count: 1 }) as never,
    });
    const sourceMetadata = (enriched as { source_metadata: Record<string, unknown> }).source_metadata;
    expect(sourceMetadata).toMatchObject({ kind: "generated_ouvrage" });
    expect(sourceMetadata).not.toHaveProperty("takeoff_provision");
    expect(takeoffProvisionExportLabel(sourceMetadata)).toBe("");
  });
});
