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
  createServiceRoleClient: vi.fn(),
}));

import { renderToBuffer } from "@react-pdf/renderer";

import {
  generateEstimatePdfNow,
  getEstimatePdfLayoutConfiguration,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
  markEstimatePdfProcessing,
} from "@/lib/estimates/pdf-generator";
import { PdfEstimateTotalsCard } from "@/lib/estimates/pdf-totals-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const GENERATION_TOKEN = "77777777-7777-4777-8777-777777777777";
const MISSING_TERMS_SCHEMA_ERROR = {
  code: "PGRST205",
  message:
    "Could not find the table 'public.estimate_terms_templates' in the schema cache",
  details: null,
  hint: null,
};

type EstimateDocumentMock = {
  status: "processing" | "ready" | "failed";
  file_path?: string | null;
  sha256_hash?: string | null;
  file_size_bytes?: number | null;
  generated_at?: string | null;
  last_error?: string | null;
  layout_options?: Record<string, unknown>;
  terms_snapshot?: Record<string, unknown> | null;
  published_content_revision?: number | null;
  published_purpose?: "legacy" | "manual" | "email" | "workflow" | null;
};

type PdfMockInput = {
  existingDocument?: EstimateDocumentMock | null;
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
  profile?: {
    full_name: string;
    job_title: string | null;
    phone: string | null;
    work_email: string | null;
  };
  contractorRole?: "principal" | "subcontractor";
  versionStatus?: "draft" | "sending" | "sent" | "accepted" | "archived";
  contentRevision?: number;
  calcSnapshotContentRevision?: number | null;
  calcEngineVersion?: number;
  itemOverrides?: Record<string, unknown>;
  versionTotals?: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
  };
  uploadError?: unknown;
  publishError?: unknown;
  documentState?: { value: EstimateDocumentMock | null };
  missingRoundingAdjustmentColumn?: boolean;
};

function createSupabasePdfMock(input?: PdfMockInput) {
  const documentState =
    input?.documentState ?? { value: input?.existingDocument ?? null };
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
        contractor_role: input?.contractorRole ?? "principal",
        status: input?.versionStatus ?? "draft",
        rounding_mode: "none",
        rounding_step_cents: 1,
        calc_engine_version: input?.calcEngineVersion ?? 1,
        calc_snapshot_content_revision:
          input?.calcSnapshotContentRevision ?? null,
        total_ht_cents: input?.versionTotals?.total_ht_cents ?? 10000,
        total_tax_cents: input?.versionTotals?.total_tax_cents ?? 2000,
        total_ttc_cents: input?.versionTotals?.total_ttc_cents ?? 12000,
        rounding_adjustment_cents: 0,
        content_revision: input?.contentRevision ?? 1,
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: "Projet test",
          reference: "REF-001",
          estimate_reference: "HEX_D26001MM",
          client_name: "Client test",
        },
      },
      error: null,
    }),
  };
  versionSelectBuilder.eq.mockReturnValue(versionSelectBuilder);
  const missingRoundingVersionSelectBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "42703",
        message:
          "column estimate_versions.rounding_adjustment_cents does not exist",
        details: null,
        hint: null,
      },
    }),
  };
  missingRoundingVersionSelectBuilder.eq.mockReturnValue(
    missingRoundingVersionSelectBuilder,
  );

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
          snapshot_pu_ht_cents: null,
          snapshot_fo_ht_cents: null,
          snapshot_mo_ht_cents: null,
          snapshot_mo_atelier_ht_cents: null,
          snapshot_mo_chantier_ht_cents: null,
          ...input?.itemOverrides,
        },
      ],
      error: null,
    }),
  };
  itemsBuilder.eq.mockReturnValue(itemsBuilder);

  const estimateDocumentsSelectBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => {
      const existingDocument = documentState.value;
      return {
        data:
          existingDocument == null
            ? null
            : {
              id: "66666666-6666-4666-8666-666666666666",
              created_at: "2026-02-21T00:00:00.000Z",
              updated_at: "2026-02-21T00:00:00.000Z",
              tenant_id: TENANT_ID,
              version_id: VERSION_ID,
              file_path: existingDocument.file_path ?? null,
              sha256_hash: existingDocument.sha256_hash ?? null,
              file_size_bytes: existingDocument.file_size_bytes ?? null,
              generated_by: USER_ID,
              generated_at: existingDocument.generated_at ?? null,
              status: existingDocument.status,
              last_error: existingDocument.last_error ?? null,
              layout_options: existingDocument.layout_options ?? {},
              terms_snapshot: existingDocument.terms_snapshot ?? null,
              published_content_revision:
                existingDocument.published_content_revision !== undefined
                  ? existingDocument.published_content_revision
                  : existingDocument.status === "ready"
                    ? 1
                    : null,
              published_purpose:
                existingDocument.published_purpose !== undefined
                  ? existingDocument.published_purpose
                  : existingDocument.status === "ready"
                    ? "legacy"
                    : null,
            },
        error: null,
      };
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
  const versionSelect = vi.fn((columns: string) =>
    input?.missingRoundingAdjustmentColumn &&
    columns.includes("rounding_adjustment_cents")
      ? missingRoundingVersionSelectBuilder
      : versionSelectBuilder
  );
  const from = vi.fn((table: string) => {
    if (table === "tenant_memberships") {
      return { select: vi.fn(() => tenantMembershipBuilder) };
    }
    if (table === "estimate_versions") {
      return { select: versionSelect };
    }
    if (table === "estimate_items") {
      return { select: vi.fn(() => itemsBuilder) };
    }
    if (table === "estimate_documents") {
      return { select: vi.fn(() => estimateDocumentsSelectBuilder) };
    }
    if (table === "estimate_terms_templates") {
      return { select: vi.fn(() => termsTemplateBuilder) };
    }
    if (table === "profiles") {
      return { select: vi.fn(() => profileBuilder) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from,
    storage: {
      from: vi.fn(() => ({
        upload,
        createSignedUrl,
      })),
    },
    rpc: vi.fn(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "begin_estimate_pdf_generation") {
        documentState.value = {
          ...(documentState.value ?? {}),
          status: "processing",
          last_error: null,
        };
        return {
          data: {
            generation_token: GENERATION_TOKEN,
            generation_purpose: args.p_purpose,
            generation_dispatch_id: args.p_dispatch_id,
            generation_content_revision: input?.contentRevision ?? 1,
          },
          error: null,
        };
      }

      if (functionName === "publish_estimate_pdf_generation") {
        if (!input?.publishError) {
          documentState.value = {
            ...(documentState.value ?? {}),
            status: "ready",
            file_path: String(args.p_file_path),
            sha256_hash: String(args.p_sha256_hash),
            file_size_bytes: Number(args.p_file_size_bytes),
            generated_at: String(args.p_generated_at),
            last_error: null,
            published_content_revision: input?.contentRevision ?? 1,
            published_purpose: "manual",
          };
        }
        return {
          data: input?.publishError
            ? null
            : {
                status: "ready",
                file_path: args.p_file_path,
                sha256_hash: args.p_sha256_hash,
              },
          error: input?.publishError ?? null,
        };
      }

      if (functionName === "fail_estimate_pdf_generation") {
        documentState.value = {
          ...(documentState.value ?? {}),
          status: "failed",
          last_error: String(args.p_error_message),
        };
        return {
          data: { status: "failed", last_error: args.p_error_message },
          error: null,
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    }),
    __mocks: {
      upload,
      createSignedUrl,
      documentState,
      from,
      versionSelect,
    },
  };

  return supabase;
}

function usePdfClients(input?: PdfMockInput) {
  const documentState = { value: input?.existingDocument ?? null };
  const authenticatedSupabase = createSupabasePdfMock({
    ...input,
    documentState,
  });
  const serviceRoleSupabase = createSupabasePdfMock({
    contentRevision: input?.contentRevision,
    uploadError: input?.uploadError,
    publishError: input?.publishError,
    documentState,
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    authenticatedSupabase as never,
  );
  vi.mocked(createServiceRoleClient).mockReturnValue(
    serviceRoleSupabase as never,
  );
  return { authenticatedSupabase, serviceRoleSupabase };
}

describe("estimate pdf generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });

  it("generates PDF, uploads it, stores hash and returns signed url", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const { authenticatedSupabase, serviceRoleSupabase } = usePdfClients();

    const result = await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "manual",
    });

    const expectedHash = createHash("sha256")
      .update(buffer)
      .digest("hex")
      .toLowerCase();
    const expectedPath = `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}/${expectedHash}.pdf`;

    const renderedDocument = vi.mocked(renderToBuffer).mock.calls[0]?.[0];
    const renderedDocumentJson = JSON.stringify(renderedDocument);
    expect(renderedDocumentJson).toContain(
      "Peinture et percements structurels hors perimetre."
    );
    expect(renderedDocumentJson).toContain("HEX_D26001MM");

    expect(serviceRoleSupabase.__mocks.upload).toHaveBeenCalledWith(
      expectedPath,
      buffer,
      expect.objectContaining({
        contentType: "application/pdf",
        upsert: false,
      })
    );

    expect(authenticatedSupabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      expectedPath,
      3600
    );

    expect(serviceRoleSupabase.rpc).toHaveBeenNthCalledWith(
      1,
      "begin_estimate_pdf_generation",
      expect.objectContaining({
        p_version_id: VERSION_ID,
        p_purpose: "manual",
      }),
    );
    expect(serviceRoleSupabase.rpc).toHaveBeenNthCalledWith(
      2,
      "publish_estimate_pdf_generation",
      expect.objectContaining({
        p_generation_token: GENERATION_TOKEN,
        p_file_path: expectedPath,
        p_sha256_hash: expectedHash,
        p_file_size_bytes: buffer.byteLength,
      }),
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

  it("renders reverse-charge PDFs without VAT or TTC amounts and with the legal notice", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(
      Buffer.from("pdf-binary") as never
    );
    usePdfClients({
      contractorRole: "subcontractor",
    });

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "manual",
    });

    const renderedDocument = JSON.stringify(
      vi.mocked(renderToBuffer).mock.calls[0]?.[0]
    );
    const renderedTotals = JSON.stringify(
      PdfEstimateTotalsCard({
        totalHtCents: 12000,
        totalTaxCents: 0,
        amountDueCents: 12000,
        roundingAdjustmentCents: 0,
        currency: "EUR",
        taxRateBp: 2000,
        vatReverseCharge: true,
      })
    );
    expect(renderedDocument).toContain("Autoliquidation");
    expect(renderedTotals).toContain("Total HT");
    expect(renderedTotals).not.toContain("Total TTC");
    expect(renderedDocument).not.toMatch(
      /"children":(?:\["TVA"\]|"TVA")/
    );
  });

  it("normalizes an email-only issuer and uses the service limits title", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("pdf-binary") as never);
    usePdfClients({
      profile: {
        full_name: "maxime.michel@hydroexpress.fr",
        job_title: "Charge d'affaires",
        phone: "06 00 00 00 00",
        work_email: "maxime.michel@hydroexpress.fr",
      },
    });

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

  it("uses service-role for mutations and the authenticated client for signing", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const { authenticatedSupabase, serviceRoleSupabase } = usePdfClients();

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "manual",
    });

    expect(serviceRoleSupabase.__mocks.upload).toHaveBeenCalled();
    expect(serviceRoleSupabase.rpc).toHaveBeenCalledWith(
      "publish_estimate_pdf_generation",
      expect.any(Object),
    );
    expect(serviceRoleSupabase.__mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(authenticatedSupabase.__mocks.upload).not.toHaveBeenCalled();
    expect(authenticatedSupabase.__mocks.createSignedUrl).toHaveBeenCalled();
  });

  it("fails explicitly before mutation when service-role config is absent", async () => {
    const authenticatedSupabase = createSupabasePdfMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authenticatedSupabase as never,
    );

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
        triggeredBy: "manual",
      }),
    ).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );

    expect(authenticatedSupabase.rpc).not.toHaveBeenCalled();
    expect(authenticatedSupabase.__mocks.upload).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
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
    const { serviceRoleSupabase } = usePdfClients({
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

    expect(serviceRoleSupabase.rpc).toHaveBeenCalledWith(
      "publish_estimate_pdf_generation",
      expect.objectContaining({ p_terms_snapshot: storedSnapshot }),
    );
    expect(JSON.stringify(vi.mocked(renderToBuffer).mock.calls[0]?.[0])).not.toContain(
      storedSnapshot.body
    );
  });

  it("returns existing ready PDF when force is false", async () => {
    const authenticatedSupabase = createSupabasePdfMock({
      existingDocument: {
        status: "ready",
        file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authenticatedSupabase as never,
    );

    const result = await generateEstimatePdfNow(VERSION_ID);

    expect(authenticatedSupabase.__mocks.upload).not.toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
    expect(result.download_url).toBe("https://example.com/signed");
  });

  it("keeps a historical commercial-name PDF readable after finalization", async () => {
    const legacyCommercialPath = `${TENANT_ID}/${PROJECT_ID}/HEX_D26001MM_V1.pdf`;
    const authenticatedSupabase = createSupabasePdfMock({
      versionStatus: "sent",
      existingDocument: {
        status: "ready",
        file_path: legacyCommercialPath,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
        published_content_revision: 1,
        published_purpose: "legacy",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authenticatedSupabase as never,
    );

    await expect(getEstimatePdfStatus(VERSION_ID)).resolves.toMatchObject({
      status: "ready",
      file_path: legacyCommercialPath,
    });
    expect(authenticatedSupabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      legacyCommercialPath,
      3600,
    );
  });

  it("keeps PDF reads available before the explicit rounding migration", async () => {
    const authenticatedSupabase = createSupabasePdfMock({
      missingRoundingAdjustmentColumn: true,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authenticatedSupabase as never,
    );

    await expect(getEstimatePdfStatus(VERSION_ID)).resolves.toEqual({
      status: "missing",
    });
    expect(authenticatedSupabase.__mocks.versionSelect).toHaveBeenCalledTimes(2);
    expect(
      authenticatedSupabase.__mocks.versionSelect.mock.calls[0]?.[0],
    ).toContain("rounding_adjustment_cents");
    expect(
      authenticatedSupabase.__mocks.versionSelect.mock.calls[1]?.[0],
    ).not.toContain("rounding_adjustment_cents");
  });

  it("keeps a failed regeneration failed when an older publication remains", async () => {
    const previousPath = `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`;
    const { authenticatedSupabase, serviceRoleSupabase } = usePdfClients({
      existingDocument: {
        status: "ready",
        file_path: previousPath,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
        published_content_revision: 1,
        published_purpose: "legacy",
      },
    });

    const claim = await markEstimatePdfProcessing(VERSION_ID);
    await markEstimatePdfFailed(VERSION_ID, "rendu interrompu", claim);
    const status = await getEstimatePdfStatus(VERSION_ID);

    expect(status).toEqual({
      status: "failed",
      last_error: "rendu interrompu",
    });
    expect(serviceRoleSupabase.__mocks.documentState.value).toMatchObject({
      status: "failed",
      file_path: previousPath,
      published_content_revision: 1,
    });
    expect(authenticatedSupabase.__mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a stale content revision",
      contentRevision: 2,
      publishedContentRevision: 1,
      lastError: null,
      expectedError:
        "Le document PDF ne correspond plus a la revision courante du devis.",
    },
    {
      label: "an unfinished failed attempt",
      contentRevision: 1,
      publishedContentRevision: 1,
      lastError: "generation echouee",
      expectedError: "generation echouee",
    },
  ])("does not expose ready metadata with $label", async (testCase) => {
    const supabase = createSupabasePdfMock({
      contentRevision: testCase.contentRevision,
      existingDocument: {
        status: "ready",
        file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
        published_content_revision: testCase.publishedContentRevision,
        last_error: testCase.lastError,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getEstimatePdfStatus(VERSION_ID)).resolves.toEqual({
      status: "failed",
      last_error: testCase.expectedError,
    });
    expect(supabase.__mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("regenerates instead of returning a stale cached publication", async () => {
    const buffer = Buffer.from("revision-2-pdf");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const { authenticatedSupabase, serviceRoleSupabase } = usePdfClients({
      contentRevision: 2,
      existingDocument: {
        status: "ready",
        file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
        published_content_revision: 1,
      },
    });

    const result = await generateEstimatePdfNow(VERSION_ID);

    expect(serviceRoleSupabase.__mocks.upload).toHaveBeenCalledOnce();
    expect(serviceRoleSupabase.rpc).toHaveBeenCalledWith(
      "begin_estimate_pdf_generation",
      expect.any(Object),
    );
    expect(authenticatedSupabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      result.file_path,
      3600,
    );
  });

  it("does not sign a forged cached path and regenerates the canonical PDF", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);
    const { authenticatedSupabase, serviceRoleSupabase } = usePdfClients({
      existingDocument: {
        status: "ready",
        file_path: "foreign-tenant/foreign-project/private.pdf",
        sha256_hash: "a".repeat(64),
        file_size_bytes: 42,
        generated_at: "2026-02-21T00:00:00.000Z",
      },
    });

    const result = await generateEstimatePdfNow(VERSION_ID);
    const expectedHash = createHash("sha256")
      .update(buffer)
      .digest("hex")
      .toLowerCase();
    const expectedPath = `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}/${expectedHash}.pdf`;

    expect(serviceRoleSupabase.__mocks.upload).toHaveBeenCalledWith(
      expectedPath,
      buffer,
      expect.any(Object)
    );
    expect(authenticatedSupabase.__mocks.createSignedUrl).toHaveBeenCalledWith(
      expectedPath,
      3600
    );
    expect(authenticatedSupabase.__mocks.createSignedUrl).not.toHaveBeenCalledWith(
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

  it.each(["sent", "accepted", "archived"] as const)(
    "refuses to replace a contractual PDF for a %s estimate",
    async (versionStatus) => {
      const supabase = createSupabasePdfMock({
        versionStatus,
        existingDocument: {
          status: "ready",
          file_path: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
          sha256_hash: "a".repeat(64),
          file_size_bytes: 42,
          generated_at: "2026-02-21T00:00:00.000Z",
        },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      await expect(
        generateEstimatePdfNow(VERSION_ID, {
          force: true,
          triggeredBy: "manual",
        })
      ).rejects.toMatchObject({
        status: 403,
        code: "ESTIMATE_PDF_CONTRACT_IMMUTABLE",
      });
      await expect(markEstimatePdfProcessing(VERSION_ID)).rejects.toMatchObject({
        status: 403,
        code: "ESTIMATE_PDF_CONTRACT_IMMUTABLE",
      });
      expect(supabase.__mocks.upload).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  );

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

  it("publishes an email PDF only against its reserved dispatch", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("email-pdf") as never);
    const { serviceRoleSupabase } = usePdfClients({
      versionStatus: "sending",
    });
    const dispatchId = "99999999-9999-4999-8999-999999999999";

    await generateEstimatePdfNow(VERSION_ID, {
      force: true,
      triggeredBy: "send",
      dispatchId,
    });

    expect(serviceRoleSupabase.rpc).toHaveBeenNthCalledWith(
      1,
      "begin_estimate_pdf_generation",
      expect.objectContaining({
        p_purpose: "email",
        p_dispatch_id: dispatchId,
      }),
    );
  });

  it.each(["manual", "send"] as const)(
    "uses the frozen v2 projection during %s generation while status is still draft",
    async (triggeredBy) => {
      vi.mocked(renderToBuffer).mockResolvedValue(
        Buffer.from("v2-send-pdf") as never
      );
      const { authenticatedSupabase } = usePdfClients({
        versionStatus: "draft",
        calcEngineVersion: 2,
        calcSnapshotContentRevision: 1,
        versionTotals: {
          total_ht_cents: 19_000,
          total_tax_cents: 3_800,
          total_ttc_cents: 22_800,
        },
        itemOverrides: {
          quantity: 2,
          pu_ht_cents: 7_777,
          snapshot_pu_ht_cents: 9_500,
          snapshot_fo_ht_cents: 12_000,
          snapshot_mo_ht_cents: 7_000,
          snapshot_mo_atelier_ht_cents: 3_000,
          snapshot_mo_chantier_ht_cents: 4_000,
          line_total_ht_cents: 19_000,
          line_tax_cents: 3_800,
          line_total_ttc_cents: 22_800,
        },
      });

      await generateEstimatePdfNow(VERSION_ID, {
        force: true,
        triggeredBy,
      });

      const rendered = JSON.stringify(
        vi.mocked(renderToBuffer).mock.calls[0]?.[0]
      );
      expect(rendered).toContain(
        `"lineUnitPriceHtById":{"55555555-5555-4555-8555-555555555555":9500}`
      );
      const queriedTables = authenticatedSupabase.__mocks.from.mock.calls.map(
        ([table]) => table
      );
      expect(queriedTables).not.toContain("labor_roles");
      expect(queriedTables).not.toContain("margin_tiers");
      expect(queriedTables).not.toContain("feature_flags");
    }
  );

  it("never marks a superseded publication as the current PDF", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("stale-pdf") as never);
    const { serviceRoleSupabase } = usePdfClients({
      publishError: {
        code: "40001",
        message: "ESTIMATE_PDF_GENERATION_SUPERSEDED",
      },
    });

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
        triggeredBy: "manual",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_PDF_GENERATION_SUPERSEDED",
    });

    expect(serviceRoleSupabase.rpc).toHaveBeenLastCalledWith(
      "fail_estimate_pdf_generation",
      expect.objectContaining({ p_generation_token: GENERATION_TOKEN }),
    );
  });

  it("treats an existing immutable hash object as an idempotent upload", async () => {
    vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("same-pdf") as never);
    const { serviceRoleSupabase } = usePdfClients({
      uploadError: {
        statusCode: "400",
        error: "Asset Already Exists",
        message: "The resource already exists",
      },
    });

    await expect(
      generateEstimatePdfNow(VERSION_ID, {
        force: true,
        triggeredBy: "manual",
      }),
    ).resolves.toMatchObject({ status: "ready" });

    expect(serviceRoleSupabase.rpc).toHaveBeenCalledWith(
      "publish_estimate_pdf_generation",
      expect.any(Object),
    );
  });

  it("marks document as failed when upload fails", async () => {
    const buffer = Buffer.from("pdf-binary");
    vi.mocked(renderToBuffer).mockResolvedValue(buffer as never);

    const { serviceRoleSupabase } = usePdfClients({
      uploadError: {
        statusCode: "404",
        error: "Bucket not found",
        message: "Bucket not found",
      },
    });

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

    expect(serviceRoleSupabase.rpc).toHaveBeenLastCalledWith(
      "fail_estimate_pdf_generation",
      expect.objectContaining({
        p_generation_token: GENERATION_TOKEN,
        p_error_message:
          "Le stockage PDF n'est pas configure pour cet environnement.",
      }),
    );
  });

  it("marks generation failure in estimate_documents", async () => {
    const { serviceRoleSupabase } = usePdfClients();

    await markEstimatePdfFailed(VERSION_ID, "erreur test", {
      token: GENERATION_TOKEN,
      purpose: "manual",
      dispatchId: null,
      contentRevision: 1,
    });

    expect(serviceRoleSupabase.rpc).toHaveBeenCalledWith(
      "fail_estimate_pdf_generation",
      expect.objectContaining({ p_error_message: "erreur test" }),
    );
  });
});
