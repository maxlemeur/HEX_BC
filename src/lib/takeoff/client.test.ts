import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  fetchTakeoffMappingRules,
  isTakeoffApiError,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/client";

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const MAPPING_RULE = {
  id: RULE_ID,
  tenant_id: "44444444-4444-4444-8444-444444444444",
  created_at: "2026-02-24T10:00:00.000Z",
  updated_at: "2026-02-24T10:00:00.000Z",
  created_by: "55555555-5555-4555-8555-555555555555",
  name: "Affecter Placo en Cloisons",
  match_pattern: "placo",
  match_type: "contains" as const,
  priority: 10,
  is_active: true,
  action: "set_category" as const,
  action_params: {
    category_id: CATEGORY_ID,
  },
};

const CREATE_INPUT = {
  name: "Affecter Placo en Cloisons",
  match_pattern: "placo",
  match_type: "contains" as const,
  action: "set_category" as const,
  action_params: {
    category_id: CATEGORY_ID,
  },
};

const UPDATE_INPUT = {
  priority: 15,
  is_active: false,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("takeoff client mapping rules wrappers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches mapping rules via GET and unwraps the API envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          mapping_rules: [MAPPING_RULE],
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTakeoffMappingRules();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/takeoff/mapping-rules",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual([MAPPING_RULE]);
  });

  it("creates a mapping rule via POST and sends JSON payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: true,
          data: {
            mapping_rule: MAPPING_RULE,
          },
        },
        201
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createTakeoffMappingRule(CREATE_INPUT);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/takeoff/mapping-rules",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(CREATE_INPUT);
    expect(result).toEqual(MAPPING_RULE);
  });

  it("updates a mapping rule via PATCH with an encoded rule id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          mapping_rule: {
            ...MAPPING_RULE,
            priority: 15,
            is_active: false,
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const complexRuleId = `${RULE_ID}/subpath`;
    const result = await updateTakeoffMappingRule(complexRuleId, UPDATE_INPUT);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/takeoff/mapping-rules/${encodeURIComponent(complexRuleId)}`,
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(UPDATE_INPUT);
    expect(result.priority).toBe(15);
    expect(result.is_active).toBe(false);
  });

  it("deletes a mapping rule via DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          deleted: true,
          rule_id: RULE_ID,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteTakeoffMappingRule(RULE_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/takeoff/mapping-rules/${RULE_ID}`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual({
      deleted: true,
      rule_id: RULE_ID,
    });
  });

  it("throws TakeoffApiError on non-2xx responses and preserves metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Acces refuse.",
            retryable: true,
            jobId: JOB_ID,
            level: "A",
            details: {
              reason: "MISSING_ROLE",
            },
          },
        },
        403
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchTakeoffMappingRules().catch((caught) => caught);

    expect(isTakeoffApiError(error)).toBe(true);
    if (!isTakeoffApiError(error)) {
      return;
    }

    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.retryable).toBe(true);
    expect(error.jobId).toBe(JOB_ID);
    expect(error.level).toBe("A");
    expect(error.details).toEqual({
      reason: "MISSING_ROLE",
    });
  });

  it("throws TakeoffApiError when envelope has ok=false on a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Payload invalide.",
          details: {
            field: "match_pattern",
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await createTakeoffMappingRule(CREATE_INPUT).catch(
      (caught) => caught
    );

    expect(isTakeoffApiError(error)).toBe(true);
    if (!isTakeoffApiError(error)) {
      return;
    }

    expect(error.status).toBe(200);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Payload invalide.");
    expect(error.details).toEqual({
      field: "match_pattern",
    });
  });
});
