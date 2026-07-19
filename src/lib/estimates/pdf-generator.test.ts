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

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(() => null),
}));

import { renderToBuffer } from "@react-pdf/renderer";

import {
  generateEstimatePdfNow,
  getEstimatePdfLayoutConfiguration,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
} from "@/lib/estimates/pdf-generator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const MISSING_TERMS_SCHEMA_ERROR = {
  code: "PGRST205",
  message:
    "Could not find the table 'public.estimate_terms_templates' in the schema cache",
  details: null,
  hint: null,
};
const MISSING_PDF_METADATA_COLUMN_ERROR = {
  code: "PGRST204",
  message:
    "Could not find the 'layout_options' column of 'estimate_documents' in the schema cache",
  details: null,
  hint: null,
};

function createSupabasePdfMock(input?: {
  existingDocument?: {
    status: "processing" | "ready" | "failed";
    file_path?: string | null;
    sha256_hash?: string | null;
    file_size_bytes?: number | null;
    generated_at?: string | null;
    last_error?: string | null;
    layout_options?: Record<string, unknown>;
    terms_snapshot?: Record<string, unknown> | null;
  } | null;
  termsTemplate?: {
    id: string;
    tenant_id: string;
    title: string;
    body: string;
    version: number;
    policy: "optional" | "default" | "required";
    legal_reviewed_at: string;
  } | null;
  termsTemplateError?: unknown;
  documentUpsertErrors?: unknown[];
  profile?: {
    full_name: string;
    job_title: string | null;
    phone: string | null;
    work_email: string | null;
  };
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
        exclusions: "Peinture et percements structurels hors perimetre.",
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

  const documentUpsertErrors = [...(input?.documentUpsertErrors ?? [])];
  const estimateDocumentsUpsert = vi.fn().mockImplementation(async () => ({
    error: documentUpsertErrors.shift() ?? null,
  }));
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
              layout_options: input.existingDocument?.layout_options ?? {},
              terms_snapshot: input.existingDocument?.terms_snapshot ?? null,
            },
      error: null,
    }),
  };
  estimateDocumentsSelectBuilder.eq.mockReturnValue(estimateDocumentsSelectBuilder);

  const termsTemplateBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: input?.termsTemplate ?? null,
      error: input?.termsTemplateError ?? null,
    }),
  };
  termsTemplateBuilder.eq.mockReturnValue(termsTemplateBuilder);

  const profileBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        input?.profile ??
        {
          full_name: "Maxime Michel",
          job_title: "Charge d'affaires",
          phone: "06 00 00 00 00",
          work_email: "maxime@example.com",
        },
      error: null,
    }),
  };
  profileBuilder.eq.mockReturnValue(profileBuilder);

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

      if (table === "estimate_terms_templates") {
        return {
          select: vi.fn(() => termsTemplateBuilder),
        };
      }

      if (table === "profiles") {
        return {
          select: vi.fn(() => profileBuilder),
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
    vi.mocked(createOptionalServiceRoleClient).mockReturnValue(null);
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

    const renderedDocument = vi.mocked(renderToBuffer).mock.calls[0]?.[0];
    expect(JSON.stringify(renderedDocument)).toContain(
      "Peinture et percements structurels hors perimetre."
    );

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

  it("normalizes an email-only issuer and uses the service limits title", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("pdf-binary") as never);
    const supabase = createSupabasePdfMock({
      profile: {
        full_name: "maxime.michel@hydroexpress.fr",
        job_title: "Charge d'affaires",
        phone: "06 00 00 00 00",
        work_email: "maxime.michel@hydroexpress.fr",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      layout: {
        preset: "client_detailed",
        detailLevel: "lines",
        priceMode: "unit_and_total",
        density: "standard",
        showNumbering: true,
        showSectionSubtotals: true,
        conditionsPlacement: "new_page",
        includeTerms: false,
      },
    });

    const renderedDocument = JSON.stringify(
      vi.mocked(renderToBuffer).mock.calls[0]?.[0]
    );
    expect(renderedDocument).toContain("Maxime MICHEL");
    expect(renderedDocument).toContain("Précisions et limites de prestation");
    expect(renderedDocument).not.toContain("Precisions et exclusions");
  });

  it("treats an unapplied CGV migration as unavailable configuration", async () => {
    const supabase = createSupabasePdfMock({
      termsTemplateError: MISSING_TERMS_SCHEMA_ERROR,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const configuration = await getEstimatePdfLayoutConfiguration(VERSION_ID);

    expect(configuration).toMatchObject({
      lineCount: 1,
      hasConditions: true,
      terms: {
        available: false,
        policy: "optional",
        title: null,
        version: null,
      },
    });
  });

  it("generates without CGV against the legacy PDF document schema", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const supabase = createSupabasePdfMock({
      termsTemplateError: MISSING_TERMS_SCHEMA_ERROR,
      documentUpsertErrors: [
        null,
        MISSING_PDF_METADATA_COLUMN_ERROR,
        null,
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      layout: {
        preset: "client_detailed",
        detailLevel: "lines",
        priceMode: "unit_and_total",
        density: "standard",
        showNumbering: true,
        showSectionSubtotals: true,
        conditionsPlacement: "auto",
        includeTerms: false,
      },
    });

    const readyPayloads = vi
      .mocked(supabase.__mocks.estimateDocumentsUpsert)
      .mock.calls.map((call) => call[0])
      .filter((payload) => payload.status === "ready");

    expect(readyPayloads).toHaveLength(2);
    expect(readyPayloads[0]).toHaveProperty("layout_options");
    expect(readyPayloads[1]).not.toHaveProperty("layout_options");
    expect(readyPayloads[1]).not.toHaveProperty("terms_snapshot");
    expect(result.status).toBe("ready");
  });

  it("does not discard a selected CGV snapshot on a legacy schema", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const supabase = createSupabasePdfMock({
      termsTemplate: {
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_ID,
        title: "Conditions generales de vente",
        body: "Texte juridiquement valide.",
        version: 3,
        policy: "optional",
        legal_reviewed_at: "2026-07-01T00:00:00.000Z",
      },
      documentUpsertErrors: [null, MISSING_PDF_METADATA_COLUMN_ERROR, null],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
        layout: {
          preset: "client_detailed",
          detailLevel: "lines",
          priceMode: "unit_and_total",
          density: "standard",
          showNumbering: true,
          showSectionSubtotals: true,
          conditionsPlacement: "auto",
          includeTerms: true,
        },
      })
    ).rejects.toMatchObject({
      message: "Impossible de mettre a jour le statut du document PDF.",
    });

    const readyPayloads = vi
      .mocked(supabase.__mocks.estimateDocumentsUpsert)
      .mock.calls.map((call) => call[0])
      .filter((payload) => payload.status === "ready");
    expect(readyPayloads).toHaveLength(1);
    expect(readyPayloads[0]).toHaveProperty("terms_snapshot");
  });

  it("keeps unexpected CGV loading errors visible", async () => {
    const supabase = createSupabasePdfMock({
      termsTemplateError: {
        code: "42501",
        message: "permission denied for table estimate_terms_templates",
        details: null,
        hint: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getEstimatePdfLayoutConfiguration(VERSION_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Acces refuse.",
    });
  });

  it("prefers the service-role storage client when available", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const supabase = createSupabasePdfMock();
    const serviceRoleSupabase = createSupabasePdfMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(createOptionalServiceRoleClient).mockReturnValue(serviceRoleSupabase as never);

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "manual",
    });

    expect(serviceRoleSupabase.__mocks.upload).toHaveBeenCalled();
    expect(serviceRoleSupabase.__mocks.createSignedUrl).toHaveBeenCalled();
    expect(supabase.__mocks.upload).not.toHaveBeenCalled();
    expect(supabase.__mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("conserve le snapshot CGV initial lors d'une regeneration sans annexe", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const storedSnapshot = {
      templateId: "77777777-7777-4777-8777-777777777777",
      title: "CGV historiques",
      body: "Texte juridiquement valide lors de l'emission.",
      version: 2,
      legalReviewedAt: "2026-01-15T00:00:00.000Z",
      capturedAt: "2026-02-01T00:00:00.000Z",
    };
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        generated_at: "2026-02-21T00:00:00.000Z",
        terms_snapshot: storedSnapshot,
      },
      termsTemplate: {
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_ID,
        title: "CGV actuelles",
        body: "Nouvelle version qui ne doit pas remplacer le snapshot.",
        version: 3,
        policy: "optional",
        legal_reviewed_at: "2026-07-01T00:00:00.000Z",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      layout: {
        preset: "client_detailed",
        detailLevel: "lines",
        priceMode: "unit_and_total",
        density: "standard",
        showNumbering: true,
        showSectionSubtotals: true,
        conditionsPlacement: "auto",
        includeTerms: false,
      },
    });

    const readyPayload = vi
      .mocked(supabase.__mocks.estimateDocumentsUpsert)
      .mock.calls.map((call) => call[0])
      .find((payload) => payload.status === "ready");
    expect(readyPayload).toMatchObject({ terms_snapshot: storedSnapshot });
    expect(JSON.stringify(vi.mocked(renderToBuffer).mock.calls[0]?.[0])).not.toContain(
      storedSnapshot.body
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

  it("does not sign a forged cached path and regenerates the canonical PDF", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: "foreign-tenant/foreign-project/private.pdf",
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await generateEstimatePdfNow(VERSION_ID);
    const expectedPath = `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`;

    expect(supabase.__mocks.upload).toHaveBeenCalledWith(
      expectedPath,
      buffer,
      expect.any(Object)
    );
    expect(supabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      expectedPath,
      3600
    );
    expect(supabase.__mocks.createSignedUrl).not.toHaveBeenCalledWith(
      "foreign-tenant/foreign-project/private.pdf",
      expect.any(Number)
    );
    expect(result.file_path).toBe(expectedPath);
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

  it("fails closed without signing when ready metadata contains a foreign path", async () => {
    const supabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: "foreign-tenant/foreign-project/private.pdf",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const status = await getEstimatePdfStatus(VERSION_ID);

    expect(status).toEqual({
      status: "failed",
      last_error: "Chemin du document PDF non conforme.",
    });
    expect(supabase.__mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("marks document as failed when upload fails", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const supabase = createSupabasePdfMock({
      uploadError: {
        statusCode: "404",
        error: "Bucket not found",
        message: "Bucket not found",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
      })
    ).rejects.toMatchObject({
      code: "PDF_GENERATION_FAILED",
      message: "Le stockage PDF n'est pas configure pour cet environnement.",
      details: {
        reason: "bucket_missing",
      },
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
          last_error: "Le stockage PDF n'est pas configure pour cet environnement.",
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
