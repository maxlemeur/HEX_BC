import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parseFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFileParser", () => ({
  useFileParser: () => ({
    parseFile: parseFileMock,
  }),
}));

import { useImportFlow } from "@/hooks/useImportFlow";
import type { TabularPdfReviewPayload } from "@/hooks/useImportFlow";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("useImportFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseFileMock.mockResolvedValue({
      mode: "worker",
      parser: "csv",
      rows: [{ designation: "Tube DN15" }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a successful import when imports refresh fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            data: {
              id: "import-created",
            },
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: {
              message: "Service temporairement indisponible",
            },
          },
          503
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImportFlow());

    await waitFor(() => {
      expect(result.current.isLoadingImports).toBe(false);
    });

    const file = new File(["a,b\n1,2"], "sample.csv", { type: "text/csv" });

    let success = false;
    await act(async () => {
      success = await result.current.importFile(file);
    });

    expect(success).toBe(true);
    expect(result.current.submitError).toBeNull();
    expect(result.current.lastImportId).toBe("import-created");
    expect(result.current.modeMessage).toContain("navigateur");
    expect(result.current.loadError).toContain("HTTP 503");
  });

  it("passes projectId in worker JSON import payload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            data: {
              id: "import-with-project",
            },
          },
          201
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));

    vi.stubGlobal("fetch", fetchMock);

    const projectId = "33333333-3333-4333-8333-333333333333";
    const { result } = renderHook(() => useImportFlow({ projectId }));

    await waitFor(() => {
      expect(result.current.isLoadingImports).toBe(false);
    });

    const file = new File(["a,b\n1,2"], "sample.csv", { type: "text/csv" });

    await act(async () => {
      await result.current.importFile(file);
    });

    const createCall = fetchMock.mock.calls[1];
    expect(createCall?.[0]).toBe("/api/imports");
    const createInit = createCall?.[1] as RequestInit;
    expect(createInit.method).toBe("POST");
    expect(createInit.headers).toEqual({
      "Content-Type": "application/json",
    });

    const payload = JSON.parse(String(createInit.body)) as {
      projectId?: string | null;
    };
    expect(payload.projectId).toBe(projectId);
  });

  it("passes projectId in multipart fallback payload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            data: {
              id: "import-fallback-project",
            },
          },
          201
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", undefined);

    const projectId = "44444444-4444-4444-8444-444444444444";
    const { result } = renderHook(() => useImportFlow({ projectId }));

    await waitFor(() => {
      expect(result.current.isLoadingImports).toBe(false);
    });

    const oversizedFile = new File(
      [new Uint8Array((5 * 1024 * 1024) + 1)],
      "large.csv",
      { type: "text/csv" }
    );

    await act(async () => {
      await result.current.importFile(oversizedFile);
    });

    expect(parseFileMock).not.toHaveBeenCalled();

    const createCall = fetchMock.mock.calls[1];
    expect(createCall?.[0]).toBe("/api/imports");
    const createInit = createCall?.[1] as RequestInit;
    expect(createInit.method).toBe("POST");
    expect(createInit.body).toBeInstanceOf(FormData);
    const formData = createInit.body as FormData;
    expect(formData.get("projectId")).toBe(projectId);
  });

  it("reviews then imports a tabular pdf through the canonical JSON contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            data: {
              source_file_name: "lot-cvc.pdf",
              source_document_id: null,
              tables: [
                {
                  page: 2,
                  tableIndex: 0,
                  title: "Lot CVC",
                  headers: ["Code", "Description"],
                  rows: [{ rowIndex: 0, cells: ["A-001", "Cable"] }],
                },
              ],
              review: {
                review_state: "light_validation",
                import_filename: "lot-cvc.pdf",
                source_file_name: "lot-cvc.pdf",
                source_document_id: null,
                summary: {
                  total_tables: 1,
                  approvable_tables: 1,
                  rejected_tables: 0,
                  total_rows: 1,
                  approvable_rows: 1,
                },
                suggested_approved_tables: [{ sourcePage: 2, tableIndex: 0 }],
                tables: [],
              },
            },
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            data: {
              id: "pdf-import-id",
            },
          },
          201
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useImportFlow());

    await waitFor(() => {
      expect(result.current.isLoadingImports).toBe(false);
    });

    const file = new File(["%PDF-1.7"], "lot-cvc.pdf", {
      type: "application/pdf",
    });

    let reviewResult: TabularPdfReviewPayload | null = null;
    await act(async () => {
      reviewResult = await result.current.reviewTabularPdfFile(file);
    });

    expect((reviewResult as TabularPdfReviewPayload | null)?.review.review_state).toBe(
      "light_validation"
    );

    let success = false;
    await act(async () => {
      success = await result.current.importReviewedPdfFile({
        file,
        pdfReview: reviewResult!,
        approvedTables: [{ sourcePage: 2, tableIndex: 0 }],
      });
    });

    expect(success).toBe(true);
    expect(result.current.lastImportId).toBe("pdf-import-id");

    const createCall = fetchMock.mock.calls[2];
    expect(createCall?.[0]).toBe("/api/imports");
    const createInit = createCall?.[1] as RequestInit;
    const payload = JSON.parse(String(createInit.body)) as {
      sourceKind: string;
      validation: { approvedTables: Array<{ sourcePage: number; tableIndex: number }> };
      tables: Array<{ page: number }>;
    };
    expect(payload.sourceKind).toBe("tabular_pdf");
    expect(payload.validation.approvedTables).toEqual([
      { sourcePage: 2, tableIndex: 0 },
    ]);
    expect(payload.tables[0]?.page).toBe(2);
  });
});
