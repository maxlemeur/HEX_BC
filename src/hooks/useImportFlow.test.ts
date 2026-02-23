import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const parseFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFileParser", () => ({
  useFileParser: () => ({
    parseFile: parseFileMock,
  }),
}));

import { useImportFlow } from "@/hooks/useImportFlow";

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
});
