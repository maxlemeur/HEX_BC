import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTakeoffJob,
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  fetchTakeoffJobCompare,
  fetchTakeoffMappingRules,
  isTakeoffApiError,
  previewTakeoffConversion,
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

const APPLY_PAYLOAD = {
  strategy: "merge" as const,
  target_section_id: "66666666-6666-4666-8666-666666666666",
  overrides: [
    {
      item_id: "77777777-7777-4777-8777-777777777777",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 1299,
      },
    },
  ],
};

const APPLY_RESPONSE = {
  job: {
    id: JOB_ID,
    estimate_version_id: "88888888-8888-4888-8888-888888888888",
    status: "applied",
    level: "A",
    source_file_name: "niveau-a.csv",
    source_file_type: "text/csv",
    source_file_size_bytes: 2048,
    prompt_version: "takeoff-a-v1",
    schema_version: "v1",
    model: "gemini-2.5-flash",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    error_code: null,
    error_message: null,
    next_retry_at: null,
    last_error_at: null,
    started_at: "2026-02-25T10:00:00.000Z",
    completed_at: "2026-02-25T10:00:10.000Z",
    created_at: "2026-02-25T09:59:00.000Z",
    updated_at: "2026-02-25T10:00:10.000Z",
    metrics: {
      token_count: 120,
      cost_cents: 4,
      duration_ms: 10000,
    },
  },
  summary: {
    scope: "section" as const,
    created_count: 1,
    updated_count: 0,
    ignored_count: 0,
    created_ids: ["99999999-9999-4999-8999-999999999999"],
  },
};

const COMPARE_RESPONSE = {
  base_job_id: JOB_ID,
  other_job_id: "77777777-7777-4777-8777-777777777777",
  threshold: 0.8,
  summary: {
    added: 1,
    removed: 0,
    changed: 2,
    unchanged: 3,
    total_base: 5,
    total_other: 6,
  },
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
};

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "merge" as const,
  target_section_id: "66666666-6666-4666-8666-666666666666",
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 1,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: "77777777-7777-4777-8777-777777777777",
      source_order: 0,
      rule_id: null,
      rule_name: null,
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 1299,
      },
      applied_by: "override" as const,
      original: {
        designation: "Cable cuivre",
        quantity: 10,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Cable cuivre",
        quantity: 10,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 1299,
        assembly_id: null,
      },
    },
  ],
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

  it("applies a takeoff job via POST and unwraps the API envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: APPLY_RESPONSE,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const complexJobId = `${JOB_ID}/segment`;
    const result = await applyTakeoffJob(complexJobId, APPLY_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/takeoff/jobs/${encodeURIComponent(complexJobId)}/apply`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(APPLY_PAYLOAD);
    expect(result).toEqual(APPLY_RESPONSE);
  });

  it("fetches a job comparison via GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: COMPARE_RESPONSE,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTakeoffJobCompare(JOB_ID, {
      withJobId: COMPARE_RESPONSE.other_job_id,
      threshold: 0.8,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/takeoff/jobs/${JOB_ID}/compare?with=${encodeURIComponent(
        COMPARE_RESPONSE.other_job_id
      )}&threshold=0.8`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual(COMPARE_RESPONSE);
  });

  it("requests a conversion preview via POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        data: PREVIEW_RESPONSE,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewTakeoffConversion(JOB_ID, APPLY_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/takeoff/jobs/${JOB_ID}/preview-conversion`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(APPLY_PAYLOAD);
    expect(result).toEqual(PREVIEW_RESPONSE);
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
