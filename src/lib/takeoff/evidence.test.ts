import { describe, expect, it, vi } from "vitest";

import {
  listSupplierPriceEvidenceRows,
  listTakeoffLineEvidenceRows,
  mapActiveLineEvidenceRowsToProofs,
  mapTakeoffLineEvidencePanel,
  syncTakeoffLineEvidences,
} from "@/lib/takeoff/evidence";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const LINE_ID = "66666666-6666-4666-8666-666666666666";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRICE_ID = "77777777-7777-4777-8777-777777777777";

type QueryResult = { data: unknown; error: unknown };

function createEvidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence-active",
    created_at: "2026-08-19T08:00:00.000Z",
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: VERSION_ID,
    takeoff_job_id: JOB_ID,
    estimate_item_id: LINE_ID,
    fingerprint: '{"type":"dpgf"}',
    evidence_type: "dpgf",
    evidence_kind: "fact",
    label: "Collecteur cuivre",
    source_label: "DPGF dpgf.xlsx",
    source_file_name: "dpgf.xlsx",
    source_page: 2,
    confidence_score: 0.91,
    note: "Ligne source 2",
    source_record_table: "estimate_items",
    source_record_id: LINE_ID,
    payload: { position: 1 },
    author_user_id: USER_ID,
    invalidated_at: null,
    invalidated_by: null,
    invalidation_reason: null,
    supersedes_evidence_id: null,
    ...overrides,
  };
}

function createSelectBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(async () => result),
    then: ((onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected)) as Promise<QueryResult>["then"],
  };
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  return builder;
}

function createUpdateBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(async () => result),
  };
  builder.eq.mockReturnValue(builder);
  return builder;
}

function createComparisonRow(
  overrides: Partial<TakeoffDpgfComparisonRow> = {},
): TakeoffDpgfComparisonRow {
  return {
    line_id: LINE_ID,
    line_label: "Collecteur cuivre",
    dpgf: {
      estimate_item_id: LINE_ID,
      title: "Collecteur cuivre",
      description: "DN20",
      quantity: 4,
      unit: "u",
      source_page: 2,
      source_file_name: "dpgf.xlsx",
      position: 1,
    },
    linked_takeoff_items: [
      {
        item_id: "takeoff-1",
        designation: "Collecteur",
        quantity: 4,
        unit: "u",
        source_page: 5,
        source_file_name: "plans.pdf",
        confidence: 0.88,
        evidence: "Zone A",
        metadata: { lot: "plomberie" },
      },
    ],
    dpgf_quantity: 4,
    takeoff_quantity: 4,
    quantity_unit: "u",
    matching_score: 0.9,
    confidence_score: 0.88,
    review_status: "reliable_match",
    proofs: [],
    suggested_decision: null,
    applied_decision: null,
    delta_absolute: 0,
    delta_percent: 0,
    is_exception: false,
    manual_link_count: 0,
    matched_by: "auto",
    risk: null,
    ...overrides,
  };
}

describe("mapActiveLineEvidenceRowsToProofs", () => {
  it("keeps active rows and drops invalidated history", () => {
    const proofs = mapActiveLineEvidenceRowsToProofs([
      createEvidenceRow(),
      createEvidenceRow({
        id: "evidence-old",
        invalidated_at: "2026-08-19T09:00:00.000Z",
        invalidation_reason: "snapshot_replaced",
        label: "Ancien collecteur",
      }),
    ] as never);

    expect(proofs).toEqual([
      {
        proof_id: "evidence-active",
        type: "dpgf",
        kind: "fact",
        label: "Collecteur cuivre",
        source: "DPGF dpgf.xlsx",
        confidence_score: 0.91,
        note: "Ligne source 2",
      },
    ]);
  });
});

describe("listTakeoffLineEvidenceRows and panel mapping", () => {
  it("returns an empty list without querying when no line ids are given", async () => {
    const from = vi.fn();

    await expect(
      listTakeoffLineEvidenceRows({
        supabase: { from } as never,
        tenantId: TENANT_ID,
        versionId: VERSION_ID,
        jobId: JOB_ID,
        lineIds: [],
        includeHistory: true,
      }),
    ).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("maps persisted rows and author names into active evidence and history", async () => {
    const replaced = createEvidenceRow({
      id: "evidence-old",
      created_at: "2026-08-19T07:00:00.000Z",
      fingerprint: '{"type":"dpgf","rev":1}',
      invalidated_at: "2026-08-19T08:00:00.000Z",
      invalidated_by: USER_ID,
      invalidation_reason: "snapshot_replaced",
    });
    const active = createEvidenceRow({
      id: "evidence-active",
      supersedes_evidence_id: "evidence-old",
    });
    const evidenceBuilder = createSelectBuilder({
      data: [active, replaced],
      error: null,
    });
    const profilesBuilder = createSelectBuilder({
      data: [{ id: USER_ID, full_name: "Ada Lovelace" }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "estimate_line_evidences") {
        return { select: vi.fn(() => evidenceBuilder) };
      }
      if (table === "profiles") {
        return { select: vi.fn(() => profilesBuilder) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const panel = await mapTakeoffLineEvidencePanel({
      supabase: { from } as never,
      tenantId: TENANT_ID,
      versionId: VERSION_ID,
      jobId: JOB_ID,
      lineId: LINE_ID,
    });

    expect(evidenceBuilder.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(evidenceBuilder.eq).toHaveBeenCalledWith("version_id", VERSION_ID);
    expect(evidenceBuilder.eq).toHaveBeenCalledWith("takeoff_job_id", JOB_ID);
    expect(evidenceBuilder.in).toHaveBeenCalledWith("estimate_item_id", [LINE_ID]);
    expect(evidenceBuilder.is).not.toHaveBeenCalled();
    expect(panel).toMatchObject({
      line_id: LINE_ID,
      version_id: VERSION_ID,
      job_id: JOB_ID,
    });
    expect(panel.evidences).toEqual([
      expect.objectContaining({
        evidence_id: "evidence-active",
        status: "active",
        author_name: "Ada Lovelace",
        supersedes_evidence_id: "evidence-old",
      }),
    ]);
    expect(panel.history).toEqual([
      expect.objectContaining({
        evidence_id: "evidence-old",
        status: "replaced",
        replaced_by_evidence_id: "evidence-active",
      }),
    ]);
  });
});

describe("listSupplierPriceEvidenceRows", () => {
  it("normalizes joined catalog SKUs into a map keyed by price id", async () => {
    const builder = createSelectBuilder({
      data: [
        {
          id: PRICE_ID,
          supplier_sku: "FALLBACK-SKU",
          unit: "u",
          unit_price_cents: 1250,
          currency: "EUR",
          valid_from: "2026-01-01",
          valid_to: null,
          notes: "promo",
          supplier_catalog_items: { supplier_sku: "CAT-42" },
        },
      ],
      error: null,
    });
    const from = vi.fn(() => ({ select: vi.fn(() => builder) }));

    const rows = await listSupplierPriceEvidenceRows({
      supabase: { from } as never,
      tenantId: TENANT_ID,
      supplierPriceIds: [PRICE_ID, PRICE_ID],
    });

    expect(builder.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(builder.in).toHaveBeenCalledWith("id", [PRICE_ID]);
    expect(rows.get(PRICE_ID)).toEqual({
      id: PRICE_ID,
      supplier_sku: "CAT-42",
      unit: "u",
      unit_price_cents: 1250,
      currency: "EUR",
      valid_from: "2026-01-01",
      valid_to: null,
      notes: "promo",
    });
  });
});

describe("syncTakeoffLineEvidences", () => {
  it("invalidates stale fingerprints and inserts the replacement snapshot", async () => {
    const existing = createEvidenceRow({
      id: "evidence-old",
      fingerprint: '{"stale":true}',
    });
    const selectBuilder = createSelectBuilder({ data: [existing], error: null });
    const updateBuilder = createUpdateBuilder({ data: null, error: null });
    const insert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => updateBuilder);
    const from = vi.fn(() => ({
      select: vi.fn(() => selectBuilder),
      update,
      insert,
    }));

    await syncTakeoffLineEvidences({
      supabase: { from } as never,
      tenantId: TENANT_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      jobId: JOB_ID,
      rows: [createComparisonRow()],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidated_by: USER_ID,
        invalidation_reason: "snapshot_replaced",
      }),
    );
    expect(updateBuilder.in).toHaveBeenCalledWith("id", ["evidence-old"]);
    expect(insert).toHaveBeenCalledTimes(1);
    const inserted = (insert.mock.calls as unknown as Array<
      [Array<Record<string, unknown>>]
    >)[0]?.[0] ?? [];
    expect(inserted.some((row) => row.evidence_type === "dpgf")).toBe(true);
    expect(inserted.some((row) => row.evidence_type === "takeoff")).toBe(true);
    expect(inserted.some((row) => row.evidence_type === "plan_zone")).toBe(true);
    expect(
      inserted.find((row) => row.evidence_type === "dpgf")?.supersedes_evidence_id,
    ).toBe("evidence-old");
  });
});
