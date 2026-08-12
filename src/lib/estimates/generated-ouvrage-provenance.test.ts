import { describe, expect, it, vi } from "vitest";

import { enrichEstimateItemsWithGeneratedOuvrageProvenance } from "@/lib/estimates/generated-ouvrage-provenance";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const CANDIDATE_ID = "66666666-6666-4666-8666-666666666666";
const GENERATED_ITEM_ID = "99999999-9999-4999-8999-999999999999";
const MANUAL_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type QueryResult = {
  data: unknown;
  error: unknown;
};

function createQueryBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
  } as {
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    then?: Promise<QueryResult>["then"];
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.then = ((onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled, onrejected)) as Promise<QueryResult>["then"];

  return builder;
}

function createSupabaseStub(
  overrides: Partial<Record<string, QueryResult>> = {}
) {
  const defaultResults: Record<string, QueryResult> = {
    estimate_generated_ouvrage_applications: { data: [], error: null },
    estimate_generated_ouvrage_candidates: { data: [], error: null },
    estimate_generated_ouvrage_drafts: { data: [], error: null },
    estimate_generated_ouvrage_candidate_sources: { data: [], error: null },
    estimate_generated_ouvrage_source_fragments: { data: [], error: null },
    estimate_generated_ouvrage_work_snapshots: { data: [], error: null },
  };
  const results = { ...defaultResults, ...overrides };
  const builders = new Map<string, ReturnType<typeof createQueryBuilder>>();
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => {
      const result = results[table];
      if (!result) {
        throw new Error(`Unexpected table: ${table}`);
      }
      const builder = createQueryBuilder(result);
      builders.set(table, builder);
      return builder;
    }),
  }));

  return {
    from,
    builders,
    supabase: { from },
  };
}

function createItem(id: string, sourceProvider = "manual") {
  return {
    id,
    title: id === GENERATED_ITEM_ID ? "Pose de faux plafond" : "Ligne manuelle",
    source_provider: sourceProvider,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: null,
    source_extracted_at: null,
  };
}

function createApplication(appliedPayload: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    draft_id: DRAFT_ID,
    candidate_id: CANDIDATE_ID,
    estimate_item_id: GENERATED_ITEM_ID,
    applied_payload: appliedPayload,
  };
}

function createCandidate() {
  return {
    id: CANDIDATE_ID,
    ai_status: "certain",
    resolution_status: "inserted",
    confidence: 0.91,
    designation: "Pose de faux plafond",
    unit: "m2",
    quantity: 120,
  };
}

function createDraft() {
  return {
    id: DRAFT_ID,
    created_at: "2026-03-07T09:01:00.000Z",
    generation_metadata: {
      prompt_version: "est381-generated-ouvrages-v1",
      used_fallback: true,
    },
  };
}

function successfulProvenanceResults(
  overrides: Partial<Record<string, QueryResult>> = {}
) {
  return {
    estimate_generated_ouvrage_applications: {
      data: [createApplication()],
      error: null,
    },
    estimate_generated_ouvrage_candidates: {
      data: [createCandidate()],
      error: null,
    },
    estimate_generated_ouvrage_drafts: {
      data: [createDraft()],
      error: null,
    },
    estimate_generated_ouvrage_candidate_sources: { data: [], error: null },
    estimate_generated_ouvrage_source_fragments: { data: [], error: null },
    estimate_generated_ouvrage_work_snapshots: { data: [], error: null },
    ...overrides,
  };
}

async function enrich(
  supabase: ReturnType<typeof createSupabaseStub>["supabase"],
  items: Array<ReturnType<typeof createItem>>
) {
  return enrichEstimateItemsWithGeneratedOuvrageProvenance({
    supabase: supabase as never,
    tenantId: TENANT_ID,
    items: items as never,
  });
}

describe("enrichEstimateItemsWithGeneratedOuvrageProvenance", () => {
  it("returns an empty input without querying persistence", async () => {
    const { from, supabase } = createSupabaseStub();
    const items: Array<ReturnType<typeof createItem>> = [];

    const result = await enrich(supabase, items);

    expect(result).toBe(items);
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves the input reference when the primary applications query fails", async () => {
    const { from, supabase } = createSupabaseStub({
      estimate_generated_ouvrage_applications: {
        data: null,
        error: { message: "applications unavailable" },
      },
    });
    const items = [createItem(GENERATED_ITEM_ID)];

    const result = await enrich(supabase, items);

    expect(result).toBe(items);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("preserves the input reference when one secondary provenance query fails", async () => {
    const { from, supabase } = createSupabaseStub(
      successfulProvenanceResults({
        estimate_generated_ouvrage_source_fragments: {
          data: null,
          error: { message: "fragments unavailable" },
        },
      })
    );
    const items = [createItem(GENERATED_ITEM_ID)];

    const result = await enrich(supabase, items);

    expect(result).toBe(items);
    expect(from).toHaveBeenCalledTimes(6);
  });

  it("keeps mixed item order and preserves untouched item references", async () => {
    const { supabase } = createSupabaseStub(successfulProvenanceResults());
    const manualItem = createItem(MANUAL_ITEM_ID);
    const generatedItem = createItem(GENERATED_ITEM_ID);
    const items = [manualItem, generatedItem];

    const result = await enrich(supabase, items);

    expect(result.map((item) => item.id)).toEqual([
      MANUAL_ITEM_ID,
      GENERATED_ITEM_ID,
    ]);
    expect(result[0]).toBe(manualItem);
    expect(result[1]).not.toBe(generatedItem);
    expect(result[1]).toMatchObject({
      source_provider: "generated_ouvrage",
      source_job_id: DRAFT_ID,
    });
  });

  it("orders source metadata by source_rank and retains snapshot evidence", async () => {
    const sourceA = {
      id: "11111111-aaaa-4111-8111-111111111111",
      draft_id: DRAFT_ID,
      source_kind: "history",
      label: "Historique",
      excerpt: "Référence historique",
      source_document_id: null,
      source_file_name: "historique.pdf",
      source_page_from: 8,
      source_page_to: 8,
      selection_label: null,
    };
    const sourceB = {
      id: "22222222-bbbb-4222-8222-222222222222",
      draft_id: DRAFT_ID,
      source_kind: "cctp_excerpt",
      label: "CCTP",
      excerpt: "Prescription CCTP",
      source_document_id: null,
      source_file_name: "cctp.pdf",
      source_page_from: 3,
      source_page_to: 4,
      selection_label: "Zone A",
    };
    const { supabase } = createSupabaseStub(
      successfulProvenanceResults({
        estimate_generated_ouvrage_candidate_sources: {
          data: [
            {
              candidate_id: CANDIDATE_ID,
              source_fragment_id: sourceA.id,
              source_rank: 2,
            },
            {
              candidate_id: CANDIDATE_ID,
              source_fragment_id: sourceB.id,
              source_rank: 1,
            },
          ],
          error: null,
        },
        estimate_generated_ouvrage_source_fragments: {
          data: [sourceA, sourceB],
          error: null,
        },
        estimate_generated_ouvrage_work_snapshots: {
          data: [
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              assembly_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              estimate_item_id: GENERATED_ITEM_ID,
              summary: {
                facts: ["Fait du snapshot"],
                risk_signals: [
                  {
                    label: "À contrôler",
                    severity: "warning",
                    basis: "fact",
                  },
                ],
              },
              components: [{ facts: ["Fait du composant"] }],
              metadata: {
                estimate_item_mapping: { mode: "legacy_labor_allocated" },
              },
            },
          ],
          error: null,
        },
      })
    );

    const [result] = await enrich(supabase, [createItem(GENERATED_ITEM_ID)]);
    const metadata = result.source_metadata as Record<string, unknown>;

    expect(metadata.sources).toEqual([
      expect.objectContaining({ source_fragment_id: sourceB.id, type: "cctp" }),
      expect.objectContaining({ source_fragment_id: sourceA.id, type: "history" }),
    ]);
    expect(metadata.facts).toEqual(["Fait du snapshot", "Fait du composant"]);
    expect(metadata.estimate_item_mapping).toEqual({
      mode: "legacy_labor_allocated",
    });
  });

  it("falls back to applied payload when the snapshot is absent", async () => {
    const { supabase } = createSupabaseStub(
      successfulProvenanceResults({
        estimate_generated_ouvrage_applications: {
          data: [
            createApplication({
              designation: "Désignation revue",
              unit: "ml",
              quantity: 42,
              resolved_lot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              estimate_item_mapping: {
                mode: "labor_hours_only",
                hMo: 12,
              },
            }),
          ],
          error: null,
        },
      })
    );

    const [result] = await enrich(supabase, [createItem(GENERATED_ITEM_ID)]);

    expect(result.source_file_name).toBe("Ouvrage genere");
    expect(result.source_metadata).toMatchObject({
      snapshot_id: null,
      assembly_id: null,
      subdetail_summary: {},
      components: [],
      applied_values: {
        designation: "Désignation revue",
        unit: "ml",
        quantity: 42,
        lot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      estimate_item_mapping: {
        mode: "labor_hours_only",
        hMo: 12,
      },
    });
  });
});
