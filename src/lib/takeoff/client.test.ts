import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTakeoffMappingRule,
  fetchAllTakeoffDpgfComparison,
  fetchTakeoffDpgfComparison,
  fetchTakeoffLineEvidencePanel,
  fetchTakeoffMappingRules,
  TAKEOFF_READ_REQUEST_TIMEOUT_MS,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const CREATE_INPUT = {
  name: "Affecter Placo en Cloisons",
  match_pattern: "placo",
  match_type: "contains" as const,
  action: "set_category" as const,
  action_params: {
    category_id: CATEGORY_ID,
  },
};

const DPGF_COMPARE_PAGE_1 = {
  version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job_id: JOB_ID,
  view: "all" as const,
  threshold: 0.8,
  summary: {
    reliable_matches: 1,
    to_confirm: 0,
    significant_gaps: 0,
    forced_manual: 0,
    lines_without_proof: 0,
    unused_takeoff_items: 1,
    total_lines: 2,
  },
  rows: [
    {
      line_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      line_label: "Cloison BA13",
      dpgf: {
        estimate_item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Cloison BA13",
        description: null,
        quantity: 12,
        unit: "m2",
        source_page: 1,
        source_file_name: "dpgf.xlsx",
        position: 1,
      },
      linked_takeoff_items: [{
        item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        designation: "Cloison BA13",
        quantity: 12,
        unit: "m2",
        source_page: 3,
        source_file_name: "plans.pdf",
        confidence: 0.91,
        evidence: "Zone cloisons",
        metadata: {},
      }],
      dpgf_quantity: 12,
      takeoff_quantity: 12,
      quantity_unit: "m2",
      matching_score: 0.98,
      confidence_score: 0.93,
      review_status: "reliable_match" as const,
      proofs: [
        {
          proof_id: "proof-1",
          type: "takeoff" as const,
          kind: "fact" as const,
          label: "Cloison BA13",
          source: "plans.pdf p.3",
          confidence_score: 0.91,
          note: "Zone cloisons",
        },
      ],
      suggested_decision: "keep_takeoff" as const,
      applied_decision: null,
      delta_absolute: 0,
      delta_percent: 0,
      is_exception: false,
      manual_link_count: 0,
      matched_by: "auto" as const,
      risk: null,
    },
  ],
  manual_link_candidates: [
    {
      item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      designation: "Cloison BA13",
      quantity: 12,
      unit: "m2",
      source_file_name: "plans.pdf",
      source_page: 3,
      confidence_score: 0.91,
      evidence: "Zone cloisons",
    },
    {
      item_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      designation: "Reserve plafond",
      quantity: 1,
      unit: "u",
      source_file_name: "plans.pdf",
      source_page: 5,
      confidence_score: 0.74,
      evidence: "Reserve",
    },
  ],
  unused_takeoff_items: [
    {
      item_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      designation: "Reserve plafond",
      quantity: 1,
      unit: "u",
      source_file_name: "plans.pdf",
      source_page: 5,
      confidence_score: 0.74,
      evidence: "Reserve",
    },
  ],
  pagination: {
    page_size: 200,
    next_cursor: "cursor-2",
    total: 2,
  },
};

const DPGF_COMPARE_PAGE_2 = {
  ...DPGF_COMPARE_PAGE_1,
  rows: [
    {
      line_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      line_label: "Peinture",
      dpgf: {
        estimate_item_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        title: "Peinture",
        description: null,
        quantity: 20,
        unit: "m2",
        source_page: 2,
        source_file_name: "dpgf.xlsx",
        position: 2,
      },
      linked_takeoff_items: [],
      dpgf_quantity: 20,
      takeoff_quantity: null,
      quantity_unit: "m2",
      matching_score: 0,
      confidence_score: 0.1,
      review_status: "unlinked" as const,
      proofs: [],
      suggested_decision: null,
      applied_decision: null,
      delta_absolute: null,
      delta_percent: null,
      is_exception: true,
      manual_link_count: 0,
      matched_by: null,
      risk: null,
    },
  ],
  pagination: {
    page_size: 200,
    next_cursor: null,
    total: 2,
  },
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails a silent GET after the shared read timeout with a retryable error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_path: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchTakeoffMappingRules();
    const assertion = expect(request).rejects.toMatchObject({
      status: 408,
      code: "TAKEOFF_REQUEST_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(TAKEOFF_READ_REQUEST_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
  });

  it("fetches and merges all DPGF comparison pages via next_cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: DPGF_COMPARE_PAGE_1,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: DPGF_COMPARE_PAGE_2,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAllTakeoffDpgfComparison(JOB_ID, {
      version_id: DPGF_COMPARE_PAGE_1.version_id,
      page_size: 200,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/takeoff/jobs/${JOB_ID}/dpgf-compare?version_id=${encodeURIComponent(
        DPGF_COMPARE_PAGE_1.version_id
      )}&page_size=200`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/takeoff/jobs/${JOB_ID}/dpgf-compare?version_id=${encodeURIComponent(
        DPGF_COMPARE_PAGE_1.version_id
      )}&cursor=${encodeURIComponent("cursor-2")}&page_size=200`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
      })
    );
    expect(result).toEqual({
      ...DPGF_COMPARE_PAGE_2,
      rows: [...DPGF_COMPARE_PAGE_1.rows, ...DPGF_COMPARE_PAGE_2.rows],
    });
  });

  it.each([
    ["job identity", { job_id: CATEGORY_ID }],
    ["view", { view: "exceptions_only" }],
    ["negative total", { pagination: { page_size: 200, next_cursor: null, total: -1 } }],
    ["nested risk", { rows: [{ ...DPGF_COMPARE_PAGE_1.rows[0], risk: { score: "high" } }] }],
  ])("rejects malformed comparison %s without retrying", async (_name, patch) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { ...DPGF_COMPARE_PAGE_1, ...patch } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTakeoffDpgfComparison(JOB_ID, { version_id: DPGF_COMPARE_PAGE_1.version_id }))
      .rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an evidence panel belonging to another line without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: {
      job_id: JOB_ID, version_id: DPGF_COMPARE_PAGE_1.version_id, line_id: CATEGORY_ID, evidences: [], history: [],
    } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTakeoffLineEvidencePanel(JOB_ID, DPGF_COMPARE_PAGE_1.rows[0].line_id, {
      version_id: DPGF_COMPARE_PAGE_1.version_id,
    })).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["duplicate rows", "changed total", "incomplete rows", "repeated cursor"])("rejects %s across comparison pages without fetching again", async (malformation) => {
    const secondPage = structuredClone(DPGF_COMPARE_PAGE_2);
    if (malformation === "duplicate rows") secondPage.rows[0].line_id = DPGF_COMPARE_PAGE_1.rows[0].line_id;
    if (malformation === "duplicate rows") secondPage.rows[0].dpgf.estimate_item_id = secondPage.rows[0].line_id;
    if (malformation === "changed total") {
      secondPage.summary.total_lines = 3;
      secondPage.pagination.total = 3;
    }
    if (malformation === "incomplete rows") secondPage.rows = [];
    const data = malformation === "repeated cursor"
      ? { ...secondPage, pagination: { ...secondPage.pagination, next_cursor: DPGF_COMPARE_PAGE_1.pagination.next_cursor } }
      : secondPage;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: DPGF_COMPARE_PAGE_1 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAllTakeoffDpgfComparison(JOB_ID, { version_id: DPGF_COMPARE_PAGE_1.version_id }))
      .rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["comparison", "evidence"])("keeps the caller abort signal for the %s read", async (read) => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const query = { version_id: DPGF_COMPARE_PAGE_1.version_id };
    const pending = read === "comparison"
      ? fetchTakeoffDpgfComparison(JOB_ID, query, { signal: controller.signal })
      : fetchTakeoffLineEvidencePanel(JOB_ID, DPGF_COMPARE_PAGE_1.rows[0].line_id, query, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws TakeoffApiError on non-2xx responses and preserves metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "Accès refuse.",
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
