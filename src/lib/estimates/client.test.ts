import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireEstimateDraftLock,
  batchEstimateOperations,
  bulkUpdateEstimateItems,
  createEstimateAssembly,
  createEstimateItem,
  deleteEstimateAssembly,
  duplicateEstimateAssembly,
  fetchEstimateAssemblies,
  fetchEstimateEditorData,
  fetchEstimatePdfStatus,
  insertAssemblyIntoVersion,
  isEstimateApiError,
  releaseEstimateDraftLock,
  requestEstimatePdfGeneration,
  renewEstimateDraftLock,
  saveEstimateVersion,
  sendEstimateSuggestionRuleFeedback,
  exportEstimate,
  updateEstimateAssembly,
  updateEstimateStatus,
} from "@/lib/estimates/client";

const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "88888888-8888-4888-8888-888888888888";
const RULE_ID = "99999999-9999-4999-8999-999999999999";
const LOCK_USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLY_TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSEMBLY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPDATED_AT = "2026-02-20T10:00:00.000Z";
const NEXT_UPDATED_AT = "2026-02-20T10:00:01.000Z";
const LOCK_EXPIRES_AT = "2026-02-20T10:30:00.000Z";

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
            committed: true,
            results: [
              {
                index: 0,
                op: "update",
                status: "ok",
                data: {
                  item: {
                    id: ITEM_ID,
                  },
                },
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
      committed: true,
      results: [
        {
          index: 0,
          op: "update",
          status: "ok",
          data: {
            item: {
              id: ITEM_ID,
            },
          },
        },
      ],
    });
  });

  it("downloads xlsx export and parses filename from Content-Disposition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("xlsx-binary", {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename=\"devis-ALPHA-v4.xlsx\"',
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exportEstimate(VERSION_ID, "xlsx");

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/export?format=xlsx`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result.filename).toBe("devis-ALPHA-v4.xlsx");
    expect(result.size).toBeGreaterThan(0);
  });

  it("includes export mode in query params when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("xlsx-binary", {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exportEstimate(VERSION_ID, "xlsx", {
      mode: "dpgf",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/export?format=xlsx&mode=dpgf`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result.filename).toBe(`devis-${VERSION_ID}.xlsx`);
    expect(result.size).toBeGreaterThan(0);
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
    } as Parameters<typeof createEstimateItem>[1]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(
      expect.objectContaining({
        item_type: "line",
        h_mo_majoration: 1.25,
        supply_type_id: SUPPLY_TYPE_ID,
      })
    );
  });

  it("parses supply_types from editor payload into supplyTypes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            version: {
              id: VERSION_ID,
              estimate_projects: { name: "Projet test" },
            },
            items: [],
            categories: [],
            supply_types: [
              {
                id: SUPPLY_TYPE_ID,
                name: "Bois",
                code: "BOIS",
                is_active: true,
                position: 1,
              },
            ],
            labor_roles: [],
            margin_tiers: [],
            suggestion_rules: [],
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

    const result = await fetchEstimateEditorData(VERSION_ID);

    expect(result.supplyTypes).toEqual([
      {
        id: SUPPLY_TYPE_ID,
        name: "Bois",
        code: "BOIS",
        is_active: true,
        position: 1,
      },
    ]);
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
              title: "Maj",
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

    const result = await saveEstimateVersion(
      VERSION_ID,
      {
        title: "Maj",
      },
      UPDATED_AT
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "If-Match": UPDATED_AT,
        }),
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      title: "Maj",
      updated_at: UPDATED_AT,
    });
    expect(result.updated_at).toBe(NEXT_UPDATED_AT);
  });

  it("exposes status and details for 409 conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "CONFLICT",
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
      await saveEstimateVersion(
        VERSION_ID,
        {
          title: "Maj",
        },
        UPDATED_AT
      );
      throw new Error("Expected saveEstimateVersion to throw.");
    } catch (error) {
      expect(isEstimateApiError(error)).toBe(true);
      if (!isEstimateApiError(error)) {
        return;
      }

      expect(error.status).toBe(409);
      expect(error.code).toBe("CONFLICT");
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

  it("sends suggestion feedback accept and returns the updated rule", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            suggestion_rule: {
              id: RULE_ID,
              name: "Bois",
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

    const result = await sendEstimateSuggestionRuleFeedback(
      VERSION_ID,
      RULE_ID,
      "accept"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/suggestion-rules/${RULE_ID}/feedback`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      feedback: "accept",
    });
    expect(result).toMatchObject({
      id: RULE_ID,
      name: "Bois",
    });
  });

  it("sends suggestion feedback count when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            suggestion_rule: {
              id: RULE_ID,
              name: "Bois",
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

    await sendEstimateSuggestionRuleFeedback(VERSION_ID, RULE_ID, "accept", 7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      feedback: "accept",
      count: 7,
    });
  });

  it("sends suggestion feedback reject and supports empty entity payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            feedback: "reject",
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

    const result = await sendEstimateSuggestionRuleFeedback(
      VERSION_ID,
      RULE_ID,
      "reject"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
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
        isOwnedByCurrentUser: null,
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

  it("fetches assembly summaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            assemblies: [
              {
                id: ASSEMBLY_ID,
                name: "Mur",
                created_at: "2026-02-21T10:00:00.000Z",
                updated_at: "2026-02-21T10:00:00.000Z",
                item_count: 2,
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEstimateAssemblies({ search: "mur" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/estimates/assemblies?search=mur",
      expect.objectContaining({ method: "GET", credentials: "same-origin" })
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: ASSEMBLY_ID,
        name: "Mur",
        itemCount: 2,
      }),
    ]);
  });

  it("creates and updates assembly payloads with snake_case items", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              assembly: {
                id: ASSEMBLY_ID,
                name: "Mur",
                created_at: "2026-02-21T10:00:00.000Z",
                updated_at: "2026-02-21T10:00:00.000Z",
                item_count: 1,
                items: [
                  {
                    id: ITEM_ID,
                    title: "Parpaing",
                    position: 1,
                  },
                ],
              },
            },
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              assembly: {
                id: ASSEMBLY_ID,
                name: "Mur renomme",
                created_at: "2026-02-21T10:00:00.000Z",
                updated_at: "2026-02-21T10:00:01.000Z",
                item_count: 1,
                items: [
                  {
                    id: ITEM_ID,
                    title: "Parpaing",
                    position: 1,
                  },
                ],
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createEstimateAssembly({
      name: "Mur",
      items: [
        {
          title: "Parpaing",
          position: 1,
          kFo: 1.2,
          kMo: 1.1,
          defaultQuantity: 2,
        },
      ],
    });
    expect(created.name).toBe("Mur");

    const createRequest = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(createRequest.body))).toEqual({
      name: "Mur",
      description: null,
      items: [
        {
          title: "Parpaing",
          unit: null,
          k_fo: 1.2,
          k_mo: 1.1,
          labor_role_id: null,
          default_quantity: 2,
          position: 1,
        },
      ],
    });

    await updateEstimateAssembly(ASSEMBLY_ID, {
      name: "Mur renomme",
      items: [
        {
          title: "Parpaing",
          position: 1,
        },
      ],
    });
    const updateRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(updateRequest.body))).toEqual({
      name: "Mur renomme",
      items: [
        {
          title: "Parpaing",
          unit: null,
          k_fo: 1,
          k_mo: 1,
          labor_role_id: null,
          default_quantity: null,
          position: 1,
        },
      ],
    });
  });

  it("duplicates an assembly via fetch detail + create and inserts into version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              assembly: {
                id: ASSEMBLY_ID,
                name: "Mur",
                created_at: "2026-02-21T10:00:00.000Z",
                updated_at: "2026-02-21T10:00:00.000Z",
                item_count: 1,
                items: [
                  {
                    id: ITEM_ID,
                    title: "Parpaing",
                    position: 1,
                    unit: "m2",
                    k_fo: 1.2,
                    k_mo: 1.1,
                    labor_role_id: null,
                    default_quantity: 2,
                  },
                ],
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              assembly: {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                name: "Mur copie",
                created_at: "2026-02-21T10:00:00.000Z",
                updated_at: "2026-02-21T10:00:00.000Z",
                item_count: 1,
                items: [],
              },
            },
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              items: [
                {
                  id: ITEM_ID,
                  item_type: "line",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const duplicated = await duplicateEstimateAssembly(ASSEMBLY_ID, {
      name: "Mur copie",
    });
    expect(duplicated.name).toBe("Mur copie");

    const inserted = await insertAssemblyIntoVersion(ASSEMBLY_ID, {
      versionId: VERSION_ID,
      afterItemId: ITEM_ID,
    });
    expect(inserted).toEqual([
      expect.objectContaining({
        id: ITEM_ID,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/assemblies/${ASSEMBLY_ID}/insert?versionId=${VERSION_ID}`,
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("deletes an assembly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { deleted_id: ASSEMBLY_ID } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await deleteEstimateAssembly(ASSEMBLY_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/assemblies/${ASSEMBLY_ID}`,
      expect.objectContaining({
        method: "DELETE",
      })
    );
  });

  it("requests manual PDF generation on the expected endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "ready",
            download_url: "https://example.com/pdf",
            file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
            sha256_hash: "a".repeat(64),
            generated_at: "2026-02-21T10:00:00.000Z",
            file_size_bytes: 1024,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestEstimatePdfGeneration(VERSION_ID, { force: true });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/pdf?force=1`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual({
      status: "ready",
      downloadUrl: "https://example.com/pdf",
      filePath: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
      sha256Hash: "a".repeat(64),
      generatedAt: "2026-02-21T10:00:00.000Z",
      fileSizeBytes: 1024,
      lastError: undefined,
    });
  });

  it("fetches PDF status from json endpoint and parses processing state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "processing",
          },
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEstimatePdfStatus(VERSION_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/pdf?format=json`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual({
      status: "processing",
      downloadUrl: undefined,
      filePath: undefined,
      sha256Hash: undefined,
      generatedAt: undefined,
      fileSizeBytes: undefined,
      lastError: undefined,
    });
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
