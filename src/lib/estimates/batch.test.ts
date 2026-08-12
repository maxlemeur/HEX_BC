import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  bulkUpdateEstimateItems: vi.fn(),
  claimEstimateBatchRevision: vi.fn(),
  createEstimateItem: vi.fn(),
  updateEstimateItem: vi.fn(),
  deleteEstimateItem: vi.fn(),
  reorderEstimateItems: vi.fn(),
  listEstimateItems: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  executeEstimateBatch,
  resolveEstimateBatchMaxOperations,
} from "@/lib/estimates/batch";
import { badRequest, conflict } from "@/lib/estimates/errors";
import {
  bulkUpdateEstimateItems,
  claimEstimateBatchRevision,
  createEstimateItem,
  deleteEstimateItem,
  listEstimateItems,
  reorderEstimateItems,
  updateEstimateItem,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";
const CHILD_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";
type EstimateItemSnapshot = Database["public"]["Tables"]["estimate_items"]["Row"];

function createSupabaseRpcStub() {
  return {
    rpc: vi.fn().mockResolvedValue({
      error: null,
    }),
  };
}

function createLineItemSnapshot(
  overrides: Partial<EstimateItemSnapshot> = {}
): EstimateItemSnapshot {
  return {
    id: ITEM_ID,
    created_at: "2026-02-21T09:30:00.000Z",
    updated_at: "2026-02-21T09:30:00.000Z",
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    parent_id: null,
    item_type: "line",
    position: 1,
    title: "Ligne",
    description: "Description",
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: 1000,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: 1000,
    line_tax_cents: 200,
    line_total_ttc_cents: 1200,
    ...overrides,
    source_provider: overrides.source_provider ?? null,
    source_job_id: overrides.source_job_id ?? null,
    source_file_name: overrides.source_file_name ?? null,
    source_page: overrides.source_page ?? null,
    source_metadata: overrides.source_metadata ?? {},
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

function createSectionItemSnapshot(
  overrides: Partial<EstimateItemSnapshot> = {}
): EstimateItemSnapshot {
  return {
    id: SECTION_ID,
    created_at: "2026-02-21T09:00:00.000Z",
    updated_at: "2026-02-21T09:00:00.000Z",
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    parent_id: null,
    item_type: "section",
    position: 1,
    title: "Section",
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    h_mo_majoration: 1,
    k_mo: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...overrides,
    source_provider: overrides.source_provider ?? null,
    source_job_id: overrides.source_job_id ?? null,
    source_file_name: overrides.source_file_name ?? null,
    source_page: overrides.source_page ?? null,
    source_metadata: overrides.source_metadata ?? {},
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

describe("executeEstimateBatch", () => {
  const originalBatchLimit = process.env.ESTIMATE_BATCH_MAX_OPERATIONS;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseRpcStub() as never
    );
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [],
    } as never);
    vi.mocked(claimEstimateBatchRevision).mockResolvedValue({
      id: VERSION_ID,
      updated_at: "2026-02-21T10:00:00.001Z",
    });
  });

  afterEach(() => {
    if (originalBatchLimit === undefined) {
      delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
      return;
    }
    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = originalBatchLimit;
  });

  it("rejects empty batches", async () => {
    await expect(
      executeEstimateBatch(VERSION_ID, [], {
        concurrencyToken: UPDATED_AT,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "operations ne peut pas etre vide.",
    });

    expect(vi.mocked(bulkUpdateEstimateItems)).not.toHaveBeenCalled();
  });

  it("enforces configurable operation limits", async () => {
    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = "1";

    await expect(
      executeEstimateBatch(
        VERSION_ID,
        [
          {
            op: "delete",
            id: ITEM_ID,
          },
          {
            op: "delete",
            id: CREATED_ITEM_ID,
          },
        ],
        {
          concurrencyToken: UPDATED_AT,
        }
      )
    ).rejects.toMatchObject({
      code: "BATCH_LIMIT_EXCEEDED",
    });
  });

  it("returns dry-run previews without applying operations", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "create",
          data: {
            item_type: "section",
            title: "Nouveau chapitre",
          },
        },
        {
          op: "reorder",
          data: {
            ordered_ids: [ITEM_ID],
          },
        },
      ],
      {
        concurrencyToken: ` ${UPDATED_AT} `,
        dryRun: true,
      }
    );

    expect(result).toEqual({
      committed: false,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
      results: [
        {
          index: 0,
          op: "create",
          status: "ok",
          data: {
            dry_run: true,
          },
        },
        {
          index: 1,
          op: "reorder",
          status: "ok",
          data: {
            dry_run: true,
          },
        },
      ],
    });
    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [],
      UPDATED_AT
    );
    expect(vi.mocked(createEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(updateEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(reorderEstimateItems)).not.toHaveBeenCalled();
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
    expect(vi.mocked(claimEstimateBatchRevision)).not.toHaveBeenCalled();
  });

  it("propagates optimistic concurrency conflicts from the token precheck", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockRejectedValue(
      conflict(
        "Version modifiee par un autre utilisateur.",
        { updated_at: "2026-02-21T10:00:01.000Z" },
        "VERSION_CONFLICT"
      )
    );

    await expect(
      executeEstimateBatch(
        VERSION_ID,
        [
          {
            op: "delete",
            id: ITEM_ID,
          },
        ],
        {
          concurrencyToken: UPDATED_AT,
        }
      )
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });

    expect(vi.mocked(createEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(updateEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(reorderEstimateItems)).not.toHaveBeenCalled();
  });

  it("stops before mutations when the atomic batch revision claim loses the race", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: { id: VERSION_ID, updated_at: UPDATED_AT },
    } as never);
    vi.mocked(claimEstimateBatchRevision).mockRejectedValue(
      conflict(
        "Version modifiee par un autre utilisateur.",
        { updated_at: UPDATED_AT },
        "VERSION_CONFLICT"
      )
    );

    await expect(
      executeEstimateBatch(
        VERSION_ID,
        [{ op: "delete", id: ITEM_ID }],
        { concurrencyToken: UPDATED_AT }
      )
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    expect(deleteEstimateItem).not.toHaveBeenCalled();
    expect(createEstimateItem).not.toHaveBeenCalled();
    expect(updateEstimateItem).not.toHaveBeenCalled();
    expect(reorderEstimateItems).not.toHaveBeenCalled();
  });

  it("returns committed=false and rolls back created rows when a later operation fails", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(createEstimateItem).mockResolvedValue({
      item: {
        id: CREATED_ITEM_ID,
      },
    } as never);
    vi.mocked(updateEstimateItem).mockRejectedValue(
      badRequest("Payload invalide.", undefined, "BAD_REQUEST")
    );
    vi.mocked(deleteEstimateItem).mockResolvedValue({
      deleted_id: CREATED_ITEM_ID,
    } as never);

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "create",
          data: {
            item_type: "section",
            title: "Ajout temporaire",
          },
        },
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Titre invalide",
          },
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        index: 0,
        op: "create",
        status: "ok",
      }),
      expect.objectContaining({
        index: 1,
        op: "update",
        status: "error",
        code: "BAD_REQUEST",
      }),
    ]);
    expect(vi.mocked(deleteEstimateItem)).toHaveBeenCalledWith(VERSION_ID, {
      id: CREATED_ITEM_ID,
    });
  });

  it("rolls back updated rows when a later operation fails", async () => {
    const originalItem = createLineItemSnapshot({
      id: ITEM_ID,
      title: "Titre initial",
      position: 2,
      quantity: 2,
      unit_price_ht_cents: 2500,
      pu_ht_cents: 3100,
      line_total_ht_cents: 6200,
      line_tax_cents: 1240,
      line_total_ttc_cents: 7440,
    });
    const upsertSpy = vi.fn().mockResolvedValue({
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        error: null,
      }),
      from: vi.fn().mockReturnValue({
        upsert: upsertSpy,
      }),
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(listEstimateItems)
      .mockResolvedValueOnce({
        items: [originalItem],
      } as never)
      .mockResolvedValueOnce({
        items: [{ ...originalItem, title: "Titre modifie" }],
      } as never);
    vi.mocked(updateEstimateItem)
      .mockResolvedValueOnce({
        item: {
          ...originalItem,
          title: "Titre modifie",
        },
      } as never);
    vi.mocked(deleteEstimateItem).mockRejectedValue(
      badRequest("Suppression refusee.", undefined, "BAD_REQUEST")
    );

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Titre modifie",
          },
        },
        {
          op: "delete",
          id: CREATED_ITEM_ID,
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(false);
    expect(vi.mocked(updateEstimateItem)).toHaveBeenNthCalledWith(1, VERSION_ID, {
      id: ITEM_ID,
      title: "Titre modifie",
    });
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ITEM_ID,
        title: "Titre initial",
        position: 2,
        quantity: 2,
        unit_price_ht_cents: 2500,
      }),
      expect.objectContaining({
        onConflict: "id",
      })
    );
  });

  it("rolls back deleted rows (including descendants) when a later operation fails", async () => {
    const sectionItem = createSectionItemSnapshot({
      id: SECTION_ID,
      position: 1,
    });
    const nestedLineItem = createLineItemSnapshot({
      id: CHILD_ITEM_ID,
      parent_id: SECTION_ID,
      position: 1,
      title: "Ligne enfant",
    });
    const survivingLine = createLineItemSnapshot({
      id: ITEM_ID,
      parent_id: null,
      position: 2,
      title: "Ligne conservee",
    });

    const upsertSpy = vi.fn().mockResolvedValue({
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        error: null,
      }),
      from: vi.fn().mockReturnValue({
        upsert: upsertSpy,
      }),
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(listEstimateItems)
      .mockResolvedValueOnce({
        items: [sectionItem, nestedLineItem, survivingLine],
      } as never)
      .mockResolvedValueOnce({
        items: [survivingLine],
      } as never);
    vi.mocked(deleteEstimateItem).mockResolvedValue({
      deleted_id: SECTION_ID,
    } as never);
    vi.mocked(updateEstimateItem).mockRejectedValue(
      badRequest("Mise a jour invalide.", undefined, "BAD_REQUEST")
    );

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "delete",
          id: SECTION_ID,
        },
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Doit echouer",
          },
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(false);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(upsertSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: SECTION_ID,
        parent_id: null,
      }),
      expect.objectContaining({
        onConflict: "id",
      })
    );
    expect(upsertSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: CHILD_ITEM_ID,
        parent_id: SECTION_ID,
      }),
      expect.objectContaining({
        onConflict: "id",
      })
    );
  });

  it("rolls back reorder operations when a later operation fails", async () => {
    const firstId = ITEM_ID;
    const secondId = CREATED_ITEM_ID;
    const thirdId = CHILD_ITEM_ID;
    const originalOrder = [firstId, secondId, thirdId];
    const reordered = [thirdId, firstId, secondId];
    const originalSiblings = [
      createLineItemSnapshot({
        id: firstId,
        position: 1,
        title: "A",
      }),
      createLineItemSnapshot({
        id: secondId,
        position: 2,
        title: "B",
      }),
      createLineItemSnapshot({
        id: thirdId,
        position: 3,
        title: "C",
      }),
    ];

    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(listEstimateItems)
      .mockResolvedValueOnce({
        items: originalSiblings,
      } as never)
      .mockResolvedValueOnce({
        items: originalSiblings,
      } as never);
    vi.mocked(reorderEstimateItems)
      .mockResolvedValueOnce({
        parent_id: null,
        ordered_ids: reordered,
        updated_count: 3,
      } as never)
      .mockResolvedValueOnce({
        parent_id: null,
        ordered_ids: originalOrder,
        updated_count: 3,
      } as never);
    vi.mocked(updateEstimateItem).mockRejectedValue(
      badRequest("Erreur metier.", undefined, "BAD_REQUEST")
    );

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "reorder",
          data: {
            ordered_ids: reordered,
          },
        },
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Doit echouer",
          },
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(false);
    expect(vi.mocked(reorderEstimateItems)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(reorderEstimateItems)).toHaveBeenNthCalledWith(
      1,
      VERSION_ID,
      {
        ordered_ids: reordered,
      }
    );
    expect(vi.mocked(reorderEstimateItems)).toHaveBeenNthCalledWith(
      2,
      VERSION_ID,
      {
        parent_id: null,
        ordered_ids: originalOrder,
      }
    );
  });

  it("keeps committed=false when rollback itself fails (best effort)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(createEstimateItem).mockResolvedValue({
      item: {
        id: CREATED_ITEM_ID,
      },
    } as never);
    vi.mocked(updateEstimateItem).mockRejectedValue(
      badRequest("Erreur metier.", undefined, "BAD_REQUEST")
    );
    vi.mocked(deleteEstimateItem).mockRejectedValue(new Error("rollback failed"));

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "create",
          data: {
            item_type: "section",
            title: "Ajout temporaire",
          },
        },
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Doit echouer",
          },
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toEqual(
      expect.objectContaining({
        status: "error",
        code: "BAD_REQUEST",
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("writes a single audit entry when the batch commits", async () => {
    const supabaseStub = createSupabaseRpcStub();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabaseStub as never);

    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: "2026-02-21T10:00:00.001Z",
      },
    } as never);
    vi.mocked(deleteEstimateItem).mockResolvedValue({
      deleted_id: ITEM_ID,
    } as never);

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "delete",
          id: ITEM_ID,
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result).toEqual({
      committed: true,
      version: {
        id: VERSION_ID,
        updated_at: "2026-02-21T10:00:00.001Z",
      },
      results: [
        {
          index: 0,
          op: "delete",
          status: "ok",
          data: {
            deleted_id: ITEM_ID,
          },
        },
      ],
    });
    expect(supabaseStub.rpc).toHaveBeenCalledWith("log_estimate_batch_audit", {
      target_version_id: VERSION_ID,
      operations_payload: [
        {
          op: "delete",
          id: ITEM_ID,
        },
      ],
    });
    expect(supabaseStub.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps committed=true when audit logging fails after writes", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const supabaseStub = {
      rpc: vi.fn().mockResolvedValue({
        error: {
          code: "PGRST202",
          message: "RPC not found",
          details: null,
          hint: null,
        },
      }),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabaseStub as never);

    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValueOnce({
      items: [createLineItemSnapshot()],
    } as never);
    vi.mocked(deleteEstimateItem).mockResolvedValue({
      deleted_id: ITEM_ID,
    } as never);

    const result = await executeEstimateBatch(
      VERSION_ID,
      [
        {
          op: "delete",
          id: ITEM_ID,
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
      }
    );

    expect(result.committed).toBe(true);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: "ok",
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Estimate batch audit failed",
      expect.anything()
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("resolveEstimateBatchMaxOperations", () => {
  const originalBatchLimit = process.env.ESTIMATE_BATCH_MAX_OPERATIONS;

  afterEach(() => {
    if (originalBatchLimit === undefined) {
      delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
      return;
    }
    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = originalBatchLimit;
  });

  it("falls back to 100 when env var is missing or invalid", () => {
    delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
    expect(resolveEstimateBatchMaxOperations()).toBe(100);

    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = "0";
    expect(resolveEstimateBatchMaxOperations()).toBe(100);

    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = "abc";
    expect(resolveEstimateBatchMaxOperations()).toBe(100);
  });

  it("supports env and explicit overrides", () => {
    process.env.ESTIMATE_BATCH_MAX_OPERATIONS = "120";
    expect(resolveEstimateBatchMaxOperations()).toBe(120);
    expect(resolveEstimateBatchMaxOperations(32)).toBe(32);
  });
});
