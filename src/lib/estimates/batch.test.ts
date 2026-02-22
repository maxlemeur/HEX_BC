import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  bulkUpdateEstimateItems: vi.fn(),
  createEstimateItem: vi.fn(),
  updateEstimateItem: vi.fn(),
  deleteEstimateItem: vi.fn(),
  reorderEstimateItems: vi.fn(),
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
  createEstimateItem,
  deleteEstimateItem,
  reorderEstimateItems,
  updateEstimateItem,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

function createSupabaseRpcStub() {
  return {
    rpc: vi.fn().mockResolvedValue({
      error: null,
    }),
  };
}

describe("executeEstimateBatch", () => {
  const originalBatchLimit = process.env.ESTIMATE_BATCH_MAX_OPERATIONS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseRpcStub() as never
    );
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
  });

  it("propagates optimistic concurrency conflicts from the token precheck", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockRejectedValue(
      conflict("Version modifiee par un autre utilisateur.", {
        updated_at: "2026-02-21T10:00:01.000Z",
      })
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
      code: "CONFLICT",
    });

    expect(vi.mocked(createEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(updateEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteEstimateItem)).not.toHaveBeenCalled();
    expect(vi.mocked(reorderEstimateItems)).not.toHaveBeenCalled();
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
        updated_at: UPDATED_AT,
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
