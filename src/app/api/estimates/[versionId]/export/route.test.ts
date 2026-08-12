import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/export-stream", () => ({
  streamEstimateVersionXlsx: vi.fn(),
}));

vi.mock("@/lib/estimates/dpgf-export", () => ({
  streamEstimateVersionDpgfXlsx: vi.fn(),
}));

vi.mock("@/lib/estimates/bdc-export", () => ({
  streamEstimateVersionBdcV11Xlsx: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/export/route";
import { streamEstimateVersionBdcV11Xlsx } from "@/lib/estimates/bdc-export";
import { streamEstimateVersionDpgfXlsx } from "@/lib/estimates/dpgf-export";
import { streamEstimateVersionXlsx } from "@/lib/estimates/export-stream";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function createSupabaseAuthMock(input: {
  userId?: string | null;
  role?: "admin" | "engineer" | "viewer";
}) {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: input.role
      ? [
          {
            tenant_id: TENANT_ID,
            role: input.role,
            is_default: true,
            created_at: "2026-02-22T10:00:00.000Z",
          },
        ]
      : [],
    error: null,
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: input.userId ? { id: input.userId } : null,
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("estimate export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns streamed xlsx with expected headers for engineer role", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: USER_ID,
        role: "engineer",
      }) as never
    );
    vi.mocked(streamEstimateVersionXlsx).mockResolvedValue({
      filename: "ALPHA_2026-v4.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      progress: "100",
      stream: Readable.toWeb(
        Readable.from([Buffer.from("xlsx-bytes")])
      ) as ReadableStream<Uint8Array>,
    });

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="ALPHA_2026-v4.xlsx"'
    );
    expect(response.headers.get("x-export-progress")).toBe("100");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(streamEstimateVersionXlsx)).toHaveBeenCalledWith(
      VERSION_ID,
      {}
    );
    expect(vi.mocked(streamEstimateVersionDpgfXlsx)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionBdcV11Xlsx)).not.toHaveBeenCalled();

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("routes mode=dpgf to DPGF exporter", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: USER_ID,
        role: "engineer",
      }) as never
    );
    vi.mocked(streamEstimateVersionDpgfXlsx).mockResolvedValue({
      filename: "ALPHA_2026-v4-dpgf.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      progress: "100",
      stream: Readable.toWeb(
        Readable.from([Buffer.from("xlsx-bytes-dpgf")])
      ) as ReadableStream<Uint8Array>,
    });

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export?mode=dpgf`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(streamEstimateVersionDpgfXlsx)).toHaveBeenCalledWith(
      VERSION_ID,
      {}
    );
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionBdcV11Xlsx)).not.toHaveBeenCalled();
  });

  it("routes mode=bdc to BDC exporter", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: USER_ID,
        role: "admin",
      }) as never
    );
    vi.mocked(streamEstimateVersionBdcV11Xlsx).mockResolvedValue({
      filename: "ALPHA_2026-v4-bdc.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      progress: "100",
      stream: Readable.toWeb(
        Readable.from([Buffer.from("xlsx-bytes-bdc")])
      ) as ReadableStream<Uint8Array>,
    });

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export?mode=bdc`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(streamEstimateVersionBdcV11Xlsx)).toHaveBeenCalledWith(
      VERSION_ID,
      {}
    );
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionDpgfXlsx)).not.toHaveBeenCalled();
  });

  it("returns 400 when format is not xlsx", async () => {
    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export?format=pdf`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
          message: "Seul le format xlsx est supporte.",
        }),
      })
    );
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
  });

  it("returns 400 when mode is invalid", async () => {
    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export?mode=csv`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
          message: "Mode d'export invalide. Valeurs supportees: standard, dpgf, bdc.",
        }),
      })
    );
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionDpgfXlsx)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionBdcV11Xlsx)).not.toHaveBeenCalled();
  });

  it("returns 403 when role is viewer", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: USER_ID,
        role: "viewer",
      }) as never
    );

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "FORBIDDEN",
          message: "Export reserve aux roles admin et engineer.",
        }),
      })
    );
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
  });

  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: null,
      }) as never
    );

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      })
    );
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
  });

  it("returns 400 when versionId is invalid", async () => {
    const response = await GET(
      new Request("http://localhost/api/estimates/not-a-uuid/export", {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: "not-a-uuid" }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
  });
});
