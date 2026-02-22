import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("logo-binary")),
}));

vi.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  renderToBuffer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { renderToBuffer } from "@react-pdf/renderer";

import {
  generateEstimatePdfNow,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
} from "@/lib/estimates/pdf-generator";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

function createSupabasePdfMock(input?: {
  existingDocument?: {
    status: "processing" | "ready" | "failed";
    file_path?: string | null;
    sha256_hash?: string | null;
    file_size_bytes?: number | null;
    generated_at?: string | null;
    last_error?: string | null;
  } | null;
  uploadError?: unknown;
}) {
  const tenantMembershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  tenantMembershipBuilder.eq.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.order.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: "engineer",
        is_default: true,
        created_at: "2026-02-21T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const versionSelectBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: VERSION_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        version_number: 1,
        date_devis: "2026-02-21",
        validite_jours: 30,
        margin_multiplier: 1.2,
        margin_mode: "fixed",
        discount_bp: 0,
        tax_rate_bp: 2000,
        rounding_mode: "none",
        rounding_step_cents: 1,
        total_ht_cents: 10000,
        total_tax_cents: 2000,
        total_ttc_cents: 12000,
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: "Projet test",
          reference: "REF-001",
          client_name: "Client test",
        },
      },
      error: null,
    }),
  };
  versionSelectBuilder.eq.mockReturnValue(versionSelectBuilder);

  const itemsBuilder = {
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          tenant_id: TENANT_ID,
          version_id: VERSION_ID,
          parent_id: null,
          item_type: "line",
          position: 1,
          title: "Ligne",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 10000,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: 10000,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          selected_supplier_price_id: null,
          line_total_ht_cents: 10000,
          line_tax_cents: 2000,
          line_total_ttc_cents: 12000,
        },
      ],
      error: null,
    }),
  };
  itemsBuilder.eq.mockReturnValue(itemsBuilder);

  const estimateDocumentsUpsert = vi.fn().mockResolvedValue({ error: null });
  const estimateDocumentsSelectBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        input?.existingDocument == null
          ? null
          : {
              id: "66666666-6666-4666-8666-666666666666",
              created_at: "2026-02-21T00:00:00.000Z",
              updated_at: "2026-02-21T00:00:00.000Z",
              tenant_id: TENANT_ID,
              version_id: VERSION_ID,
              file_path: input.existingDocument?.file_path ?? null,
              sha256_hash: input.existingDocument?.sha256_hash ?? null,
              file_size_bytes: input.existingDocument?.file_size_bytes ?? null,
              generated_by: USER_ID,
              generated_at: input.existingDocument?.generated_at ?? null,
              status: input.existingDocument?.status ?? "processing",
              last_error: input.existingDocument?.last_error ?? null,
            },
      error: null,
    }),
  };
  estimateDocumentsSelectBuilder.eq.mockReturnValue(estimateDocumentsSelectBuilder);

  const upload = vi.fn().mockResolvedValue({ error: input?.uploadError ?? null });
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: "https://example.com/signed" }, error: null });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => tenantMembershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionSelectBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      if (table === "estimate_documents") {
        return {
          select: vi.fn(() => estimateDocumentsSelectBuilder),
          upsert: estimateDocumentsUpsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({
        upload,
        createSignedUrl,
      })),
    },
    __mocks: {
      estimateDocumentsUpsert,
      upload,
      createSignedUrl,
    },
  };

  return supabase;
}

describe("estimate pdf generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates PDF, uploads it, stores hash and returns signed url", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const supabase = createSupabasePdfMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "manual",
    });

    const expectedPath = `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`;
    const expectedHash = createHash("sha256")
      .update(buffer)
      .digest("hex")
      .toLowerCase();

    expect(supabase.__mocks.upload).toHaveBeenCalledWith(
      expectedPath,
      buffer,
      expect.objectContaining({
        contentType: "application/pdf",
        upsert: true,
      })
    );

    expect(supabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      expectedPath,
      3600
    );

    const upsertPayloads = vi
      .mocked(supabase.__mocks.estimateDocumentsUpsert)
      .mock.calls.map((call) => call[0]);

    expect(upsertPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "processing",
        }),
        expect.objectContaining({
          status: "ready",
          file_path: expectedPath,
          sha256_hash: expectedHash,
          file_size_bytes: buffer.byteLength,
        }),
      ])
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "ready",
        file_path: expectedPath,
        sha256_hash: expectedHash,
        file_size_bytes: buffer.byteLength,
        download_url: "https://example.com/signed",
      })
    );
  });

  it("returns existing ready PDF when force is false", async () => {
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await generateEstimatePdfNow(VERSION_ID);

    expect(supabase.__mocks.upload).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
    expect(result.download_url).toBe("https://example.com/signed");
  });

  it("returns failed status for stored failed document", async () => {
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "failed",
        last_error: "boom",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const status = await getEstimatePdfStatus(VERSION_ID);

    expect(status).toEqual({
      status: "failed",
      last_error: "boom",
    });
  });

  it("returns missing status when no document exists", async () => {
    const supabase = createSupabasePdfMock({
      existingDocument: null,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const status = await getEstimatePdfStatus(VERSION_ID);

    expect(status).toEqual({
      status: "missing",
    });
  });

  it("returns failed status when ready row has no file path", async () => {
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const status = await getEstimatePdfStatus(VERSION_ID);

    expect(status).toEqual({
      status: "failed",
      last_error: "Chemin du document PDF manquant.",
    });
  });

  it("marks document as failed when upload fails", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const supabase = createSupabasePdfMock({
      uploadError: {
        message: "storage down",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Impossible de televerser le PDF dans le storage.",
    });

    const upsertPayloads = vi
      .mocked(supabase.__mocks.estimateDocumentsUpsert)
      .mock.calls.map((call) => call[0]);

    expect(upsertPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "processing",
        }),
        expect.objectContaining({
          status: "failed",
          file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        }),
      ])
    );
  });

  it("marks generation failure in estimate_documents", async () => {
    const supabase = createSupabasePdfMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await markEstimatePdfFailed(VERSION_ID, "erreur test");

    expect(supabase.__mocks.estimateDocumentsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        last_error: "erreur test",
      }),
      expect.objectContaining({
        onConflict: "tenant_id,version_id",
      })
    );
  });
});
