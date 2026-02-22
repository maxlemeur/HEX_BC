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

describe("estimate pdf route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST returns 202 processing when generation is started", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "missing",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "POST",
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: "processing",
        }),
      })
    );
    expect(vi.mocked(markEstimatePdfProcessing)).toHaveBeenCalledWith(VERSION_ID);
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
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

    expect(vi.mocked(markEstimatePdfFailed)).toHaveBeenCalledWith(VERSION_ID, "boom");
  });

  it("POST returns 200 ready when an existing PDF is available without force", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "ready",
      download_url: "https://example.com/download",
      file_path: "tenant/estimate/version.pdf",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "POST",
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: "ready",
        }),
      })
    );
    expect(vi.mocked(markEstimatePdfProcessing)).not.toHaveBeenCalled();
    expect(vi.mocked(generateEstimatePdfNow)).not.toHaveBeenCalled();
    expect(vi.mocked(markEstimatePdfFailed)).not.toHaveBeenCalled();
  });

  it("GET format=json returns 200 with ready status", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "ready",
      download_url: "https://example.com/download",
      file_path: "tenant/estimate/version.pdf",
      sha256_hash: "a".repeat(64),
      generated_at: "2026-02-21T00:00:00.000Z",
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

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: "ready",
        }),
      })
    );
  });

  it("GET format=json returns 202 with processing status", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "processing",
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

    expect(response.status).toBe(202);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: "processing",
        }),
      })
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

  it("GET without format returns 307 redirect when PDF is ready", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "ready",
      download_url: "https://example.com/download",
      file_path: "tenant/estimate/version.pdf",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/download");
  });

  it("GET without format returns 409 when PDF generation is processing", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "processing",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "PDF_NOT_READY",
        }),
      })
    );
  });

  it("GET without format returns 500 when PDF generation failed", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "failed",
      last_error: "boom",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "GET",
    });

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

  it("GET without format returns 404 when PDF is missing", async () => {
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "missing",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "PDF_NOT_READY",
        }),
      })
    );
  });
});
