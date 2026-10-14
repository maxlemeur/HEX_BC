import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";

import { acquireEstimateDraftLock, batchEstimateOperations, bulkUpdateEstimateItems, createEstimate, createEstimateItem, fetchEstimateList, fetchEstimatePdfStatus, getEstimateDraftLockSessionId, isEstimateApiError, releaseEstimateDraftLock, requestEstimatePdfGeneration, renewEstimateDraftLock, saveEstimateVersion, takeoverEstimateDraftLock, updateEstimateStatus } from "@/lib/estimates/client";
import type { Database } from "@/types/database";

// Keep the precode intent executable before the product exposes this contract.
const saveEstimateSettingsPrecode = saveEstimateVersion as unknown as (
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string,
  expectedContentRevision: number
) => Promise<{
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  items: Database["public"]["Tables"]["estimate_items"]["Row"][];
}>;

const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "88888888-8888-4888-8888-888888888888";
const LOCK_USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLY_TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPDATED_AT = "2026-02-20T10:00:00.000Z";
const NEXT_UPDATED_AT = "2026-02-20T10:00:01.000Z";
const LOCK_EXPIRES_AT = "2026-02-20T10:30:00.000Z";
const DRAFT_LOCK_SESSION_GLOBAL_KEY =
  "__miaouffrageEstimateDraftLockSessions";

class MemoryStorage implements Storage {
  private readonly values: Map<string, string>;

  constructor(entries: Iterable<readonly [string, string]> = []) {
    this.values = new Map(entries);
  }

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  entries() {
    return this.values.entries();
  }
}

function resetInMemoryDraftLockSessions() {
  delete (globalThis as Record<string, unknown>)[
    DRAFT_LOCK_SESSION_GLOBAL_KEY
  ];
}

function stubNavigationType(type: NavigationTimingType) {
  vi.stubGlobal("performance", {
    getEntriesByType: vi.fn().mockReturnValue([{ type }]),
  });
}

describe("estimate client optimistic concurrency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call the bulk endpoint when there are no updates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkUpdateEstimateItems(VERSION_ID, UPDATED_AT, []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      updatedCount: 0,
      versionToken: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
    });
  });

  it("propagates If-Match and returns updated token for bulk updates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            updated_count: 1,
            version: {
              id: VERSION_ID,
              updated_at: NEXT_UPDATED_AT,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkUpdateEstimateItems(VERSION_ID, UPDATED_AT, [
      {
        id: ITEM_ID,
        updates: {
          title: "Ligne test",
        },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/items/bulk`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "If-Match": UPDATED_AT,
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: expect.stringMatching(
            /^[0-9a-f-]{36}$/i
          ),
        }),
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      updated_at: UPDATED_AT,
      updates: [
        {
          id: ITEM_ID,
          title: "Ligne test",
        },
      ],
    });
    expect(result).toEqual({
      updatedCount: 1,
      versionToken: {
        id: VERSION_ID,
        updated_at: NEXT_UPDATED_AT,
      },
    });
  });

  it("sends grouped batch operations with If-Match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            committed: false,
            version: { id: VERSION_ID, updated_at: UPDATED_AT },
            results: [
              {
                index: 0,
                op: "update",
                status: "ok",
                data: { dry_run: true },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await batchEstimateOperations(
      VERSION_ID,
      UPDATED_AT,
      [
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Nouveau titre",
          },
        },
      ],
      {
        dryRun: true,
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/batch?dry_run=true`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "If-Match": UPDATED_AT,
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: expect.stringMatching(
            /^[0-9a-f-]{36}$/i
          ),
        }),
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      concurrency_token: UPDATED_AT,
      dry_run: true,
      operations: [
        {
          op: "update",
          id: ITEM_ID,
          data: {
            title: "Nouveau titre",
          },
        },
      ],
    });
    expect(result).toEqual({
      committed: false,
      versionToken: {
        id: VERSION_ID,
        updated_at: UPDATED_AT,
      },
      results: [
        {
          index: 0,
          op: "update",
          status: "ok",
          data: { dry_run: true },
        },
      ],
    });
  });

  it("includes h_mo_majoration and supply_type_id when creating line items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            item: {
              id: ITEM_ID,
              item_type: "line",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createEstimateItem(VERSION_ID, {
      version_id: VERSION_ID,
      item_type: "line",
      parent_id: null,
      position: 1,
      title: "Ligne test",
      description: null,
      quantity: 2,
      unit_price_ht_cents: 1000,
      tax_rate_bp: 2000,
      k_fo: 1.1,
      h_mo: 3,
      h_mo_majoration: 1.25,
      k_mo: 1,
      labor_role_id: null,
      category_id: null,
      supply_type_id: SUPPLY_TYPE_ID,
      source_provider: "takeoff",
      source_job_id: ITEM_ID,
      source_file_name: "quantif-lot-01.pdf",
      source_page: 3,
    } as Parameters<typeof createEstimateItem>[1]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(
      expect.objectContaining({
        item_type: "line",
        h_mo_majoration: 1.25,
        supply_type_id: SUPPLY_TYPE_ID,
        source_provider: "takeoff",
        source_job_id: ITEM_ID,
        source_file_name: "quantif-lot-01.pdf",
        source_page: 3,
      })
    );
  });

  it("omits a null product link and exposes the refreshed version token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            item: {
              id: ITEM_ID,
              item_type: "line",
            },
            version: {
              id: VERSION_ID,
              updated_at: "2026-09-03T21:00:00.000Z",
            },
          },
        }),
        {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const onVersionToken = vi.fn();

    await createEstimateItem(
      VERSION_ID,
      {
        version_id: VERSION_ID,
        item_type: "line",
        parent_id: null,
        position: 1,
        title: "Ligne sans produit",
        product_id: null,
      } as Parameters<typeof createEstimateItem>[1],
      { onVersionToken }
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("product_id");
    expect(onVersionToken).toHaveBeenCalledWith({
      id: VERSION_ID,
      updated_at: "2026-09-03T21:00:00.000Z",
    });
  });

  it("propagates If-Match for saveEstimateVersion and returns updated version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            version: {
              id: VERSION_ID,
              updated_at: NEXT_UPDATED_AT,
              content_revision: 2,
              title: "Maj",
            },
            items: [],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEstimateSettingsPrecode(
      VERSION_ID,
      {
        title: "Maj",
      },
      UPDATED_AT,
      1
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "If-Match": UPDATED_AT,
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: expect.stringMatching(
            /^[0-9a-f-]{36}$/i
          ),
        }),
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      title: "Maj",
      updated_at: UPDATED_AT,
      expected_content_revision: 1,
    });
    expect(result.version.updated_at).toBe(NEXT_UPDATED_AT);
  });

  it("exposes status, code and details for version conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "VERSION_CONFLICT",
            message: "Version modifiee par un autre utilisateur",
            details: {
              updated_at: NEXT_UPDATED_AT,
            },
          },
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await saveEstimateSettingsPrecode(
        VERSION_ID,
        {
          title: "Maj",
        },
        UPDATED_AT,
        1
      );
      throw new Error("Expected saveEstimateVersion to throw.");
    } catch (error) {
      expect(isEstimateApiError(error)).toBe(true);
      if (!isEstimateApiError(error)) {
        return;
      }

      expect(error.status).toBe(409);
      expect(error.code).toBe("VERSION_CONFLICT");
      expect(error.details).toEqual({
        updated_at: NEXT_UPDATED_AT,
      });
    }
  });

  it("propagates If-Match for updateEstimateStatus and returns updated version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            version: {
              id: VERSION_ID,
              updated_at: NEXT_UPDATED_AT,
              status: "sent",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateEstimateStatus(VERSION_ID, "sent", UPDATED_AT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/status`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "If-Match": UPDATED_AT,
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: expect.stringMatching(
            /^[0-9a-f-]{36}$/i
          ),
        }),
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      status: "sent",
      updated_at: UPDATED_AT,
    });
    expect(result.updated_at).toBe(NEXT_UPDATED_AT);
    expect(result.status).toBe("sent");
  });
});

describe("estimate client list parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes list item currencies and defaults to EUR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                project_id: PROJECT_ID,
                project_name: "Projet A",
                version_id: VERSION_ID,
                version_number: 2,
                status: "draft",
                title: "V2",
                updated_at: "2026-02-24T10:00:00.000Z",
                total_ht_cents: 120000,
                currency: " usd ",
              },
              {
                project_id: "55555555-5555-4555-8555-555555555555",
                project_name: "Projet B",
                version_id: "66666666-6666-4666-8666-666666666666",
                version_number: 1,
                status: "sent",
                title: "V1",
                updated_at: "2026-02-24T09:00:00.000Z",
                total_ht_cents: 32000,
              },
              {
                project_id: "77777777-7777-4777-8777-777777777777",
                project_name: "Projet C",
                version_id: "88888888-8888-4888-8888-888888888888",
                version_number: 3,
                status: "sending",
                title: "V3",
                updated_at: "2026-02-24T08:00:00.000Z",
                total_ht_cents: 64000,
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchEstimateList();

    expect(items).toHaveLength(3);
    expect(items[0]?.currency).toBe("USD");
    expect(items[1]?.currency).toBe("EUR");
    expect(items[2]?.status).toBe("sending");
  });
});

describe("estimate draft lock page identity", () => {
  beforeEach(() => {
    resetInMemoryDraftLockSessions();
  });

  afterEach(() => {
    resetInMemoryDraftLockSessions();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reuses the same page identity after a full reload", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    stubNavigationType("reload");

    const beforeReload = getEstimateDraftLockSessionId(VERSION_ID);
    expect([...storage.entries()][0]?.[1]).toBe(beforeReload);
    resetInMemoryDraftLockSessions();
    const afterReload = getEstimateDraftLockSessionId(VERSION_ID);

    expect(afterReload).toBe(beforeReload);
  });

  it("persists an existing in-memory identity after hot reload", () => {
    const existingSessionId = "12345678-1234-4123-8123-123456789abc";
    const storage = new MemoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    stubNavigationType("navigate");
    (globalThis as Record<string, unknown>)[DRAFT_LOCK_SESSION_GLOBAL_KEY] =
      new Map([[VERSION_ID, existingSessionId]]);

    const resolvedSessionId = getEstimateDraftLockSessionId(VERSION_ID);

    expect(resolvedSessionId).toBe(existingSessionId);
    expect([...storage.entries()][0]?.[1]).toBe(existingSessionId);
  });

  it("rotates a copied page identity in a duplicated tab", () => {
    const originalStorage = new MemoryStorage();
    vi.stubGlobal("sessionStorage", originalStorage);
    stubNavigationType("navigate");
    const originalTabId = getEstimateDraftLockSessionId(VERSION_ID);

    const duplicatedTabStorage = new MemoryStorage(originalStorage.entries());
    resetInMemoryDraftLockSessions();
    vi.stubGlobal("sessionStorage", duplicatedTabStorage);
    stubNavigationType("navigate");
    const duplicatedTabId = getEstimateDraftLockSessionId(VERSION_ID);

    expect(duplicatedTabId).not.toBe(originalTabId);
  });
});

describe("estimate client draft lock wrappers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("acquires a draft lock from the lock endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            acquired: true,
            lock: {
              version_id: VERSION_ID,
              user_id: LOCK_USER_ID,
              holder_name: "Alice Martin",
              expires_at: LOCK_EXPIRES_AT,
              is_owner: true,
              is_current_session: true,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireEstimateDraftLock(VERSION_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/lock`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual({
      acquired: true,
      lock: {
        versionId: VERSION_ID,
        userId: LOCK_USER_ID,
        holderName: "Alice Martin",
        lockedAt: null,
        expiresAt: LOCK_EXPIRES_AT,
        isOwnedByCurrentUser: true,
        isOwnedByCurrentSession: true,
      },
    });
  });

  it("returns conflict lock details when another user already holds the draft lock", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "CONFLICT",
            message: "Version deja verrouillee.",
            details: {
              version_id: VERSION_ID,
              user_id: LOCK_USER_ID,
              holder_name: "Alice Martin",
              expires_at: LOCK_EXPIRES_AT,
              is_current_user: false,
              is_current_session: false,
            },
          },
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await acquireEstimateDraftLock(VERSION_ID);

    expect(result).toEqual({
      acquired: false,
      lock: {
        versionId: VERSION_ID,
        userId: LOCK_USER_ID,
        holderName: "Alice Martin",
        lockedAt: null,
        expiresAt: LOCK_EXPIRES_AT,
        isOwnedByCurrentUser: false,
        isOwnedByCurrentSession: false,
      },
    });
  });

  it("renews draft locks with PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            renewed: true,
            lock: {
              version_id: VERSION_ID,
              user_id: LOCK_USER_ID,
              holder_name: "Alice Martin",
              expires_at: LOCK_EXPIRES_AT,
              is_owner: true,
              is_current_session: true,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await renewEstimateDraftLock(VERSION_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/lock`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
      })
    );
    expect(result.renewed).toBe(true);
    expect(result.lock?.isOwnedByCurrentUser).toBe(true);
  });

  it("takes over draft locks atomically with force PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            lock: {
              version_id: VERSION_ID,
              user_id: LOCK_USER_ID,
              holder_name: "Alice Martin",
              expires_at: LOCK_EXPIRES_AT,
              is_current_user: true,
              is_current_session: true,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await takeoverEstimateDraftLock(VERSION_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/lock?force=1`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
      })
    );
    expect(result.acquired).toBe(true);
    expect(result.lock?.isOwnedByCurrentSession).toBe(true);
  });

  it("releases draft locks with force query + keepalive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            released: true,
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await releaseEstimateDraftLock(VERSION_ID, {
      force: true,
      keepalive: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/lock?force=1`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
        keepalive: true,
      })
    );
    expect(result).toEqual({
      released: true,
    });
  });
});

describe("estimate client assemblies wrappers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends normalized PDF layout options in the generation request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { status: "processing" } }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const layout = {
      preset: "fo_mo" as const,
      detailLevel: 3 as const,
      priceMode: "fo_mo_and_total" as const,
      density: "compact" as const,
      showNumbering: true,
      showSectionSubtotals: true,
      conditionsPlacement: "new_page" as const,
      includeTerms: false,
    };

    await requestEstimatePdfGeneration(VERSION_ID, { force: true, layout });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/pdf?force=1`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: expect.any(String),
        }),
        body: JSON.stringify({ layout }),
      })
    );
  });

  it("maps PDF error payloads into normalized failed status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "PDF_GENERATION_FAILED",
            message: "La generation a echoue",
            details: {
              status: "failed",
              last_error: "boom",
            },
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEstimatePdfStatus(VERSION_ID);

    expect(result).toEqual({
      status: "failed",
      lastError: "boom",
      downloadUrl: undefined,
      filePath: undefined,
      sha256Hash: undefined,
      generatedAt: undefined,
      fileSizeBytes: undefined,
    });
  });
});

describe("estimate client creation wrappers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("omits margin_multiplier when not provided so the server inherits the project margin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: { version: { id: VERSION_ID } },
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createEstimate({
      projectId: PROJECT_ID,
      title: "Version 5",
      dateDevis: "2026-03-05",
      validiteJours: 30,
      // pas de marginMultiplier: on veut hériter de la dernière version
    });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      version: Record<string, unknown>;
    };

    expect(body.version).not.toHaveProperty("margin_multiplier");
  });
});
