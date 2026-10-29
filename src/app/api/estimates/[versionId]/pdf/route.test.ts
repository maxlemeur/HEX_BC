import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock("@/lib/estimates/pdf-generator", () => ({
  generateEstimatePdfNow: vi.fn(),
  getEstimatePdfStatus: vi.fn(),
  markEstimatePdfFailed: vi.fn(),
  markEstimatePdfProcessing: vi.fn(),
}));

import { GET, POST } from "@/app/api/estimates/[versionId]/pdf/route";
import {
  generateEstimatePdfNow,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
  markEstimatePdfProcessing,
} from "@/lib/estimates/pdf-generator";
import { after } from "next/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PUBLICATION_CLAIM = {
  token: "22222222-2222-4222-8222-222222222222",
  purpose: "manual" as const,
  dispatchId: null,
  contentRevision: 1,
};

describe("estimate pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markEstimatePdfProcessing).mockResolvedValue(
      PUBLICATION_CLAIM as never,
    );
  });

  it("POST marks failed status when async generation throws", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "missing",
    } as never);
    vi.mocked(generateEstimatePdfNow).mockRejectedValueOnce(new Error("boom"));

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "POST",
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(202);
    const scheduled = vi.mocked(after).mock.calls[0]?.[0];
    expect(typeof scheduled).toBe("function");

    await (scheduled as () => Promise<void>)();

    expect(vi.mocked(markEstimatePdfFailed)).toHaveBeenCalledWith(
      VERSION_ID,
      "boom",
      PUBLICATION_CLAIM,
    );
  });

  it("GET format=json returns 500 with failed status", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "failed",
      last_error: "boom",
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/pdf?format=json`,
      {
        method: "GET",
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "PDF_GENERATION_FAILED",
        }),
      })
    );
  });
});
