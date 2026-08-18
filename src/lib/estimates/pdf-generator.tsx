import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import {
  resolveCalcEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import { resolveRenderMarginMode } from "@/lib/estimates/margin-tiers-loader";
import {
  buildLegacyDocumentBreakdown,
  prepareEstimateDocumentData,
  summarizeEstimateDocumentStructure,
  type EstimateDocumentPreparedData,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { COMPANY_INFO } from "@/lib/company-info";
import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";
import {
  ESTIMATE_SERVICE_LIMITS_TITLE,
  ESTIMATE_VAT_REVERSE_CHARGE_NOTICE,
} from "@/lib/estimates/document-copy";
import {
  applyEstimateTermsPolicy,
  DEFAULT_ESTIMATE_PDF_LAYOUT,
  normalizeEstimatePdfLayoutOptions,
  type EstimatePdfLayoutConfiguration,
} from "@/lib/estimates/pdf-layout";
import { assertEstimatePdfMutationAllowed, type EstimatePdfLayoutOptions, type PdfGenerateOptions } from "@/lib/estimates/pdf-mutation-policy";
import {
  beginEstimatePdfGeneration,
  buildContentAddressedEstimatePdfPath,
  failEstimatePdfGeneration,
  isCanonicalEstimatePdfPath,
  isImmutableStorageObjectAlreadyPresent,
  publishEstimatePdfGeneration,
  type EstimatePdfGenerationClaim,
  type EstimatePdfGenerationPurpose,
} from "@/lib/estimates/pdf-publication";
import {
  canUseEstimateTermsSnapshot,
  createDevelopmentEstimateTermsTemplate,
  ESTIMATE_DRAFT_TERMS_NOTICE,
  parseEstimateTermsClauses,
  splitEstimateTermsClauses,
  createEstimateTermsSnapshot,
  parseEstimateTermsSnapshot,
  toEstimatePdfTermsConfiguration,
  type EstimateTermsSnapshot,
  type EstimateTermsTemplate,
} from "@/lib/estimates/pdf-terms";
import { formatEstimateReference } from "@/lib/estimates/reference";
import {
  formatCurrency,
  formatEUR,
  normalizeEstimateCurrency,
} from "@/lib/money";
import { classifyEstimatePdfStorageFailure } from "@/lib/estimates/pdf-storage-error";
import { PdfEstimateTotalsCard } from "@/lib/estimates/pdf-totals-card";
import {
  getAuthenticatedTenantContext as getAuthenticatedContext,
  type ServerSupabaseClient,
} from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";

import { internalError, mapSupabaseError, notFound } from "./errors";
import type {
  EstimateVersionChangelog,
  EstimateVersionChangelogChange,
  EstimateVersionChangelogField,
} from "./changelog";

type Supabase = ServerSupabaseClient;

type EstimateProjectRow =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateDocumentRow =
  Database["public"]["Tables"]["estimate_documents"]["Row"];
type EstimateTermsTemplateRow =
  Database["public"]["Tables"]["estimate_terms_templates"]["Row"];
type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const VERSION_ACCESS_SELECT =
  "id, tenant_id, project_id, version_number, status, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, calc_snapshot_content_revision, contractor_role, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents, currency, content_revision, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name)";
const LEGACY_VERSION_ACCESS_SELECT =
  "id, tenant_id, project_id, version_number, status, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, calc_snapshot_content_revision, contractor_role, total_ht_cents, total_tax_cents, total_ttc_cents, currency, content_revision, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name)";
type LaborRoleRate = Pick<
  Database["public"]["Tables"]["labor_roles"]["Row"],
  "id" | "hourly_rate_cents"
>;

type EmbeddedProject = Pick<
  EstimateProjectRow,
  | "id"
  | "tenant_id"
  | "user_id"
  | "name"
  | "reference"
  | "estimate_reference"
  | "client_name"
>;

type VersionWithProject = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "project_id"
  | "version_number"
  | "date_devis"
  | "validite_jours"
  | "exclusions"
  | "margin_multiplier"
  | "margin_mode"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "calc_engine_version"
  | "contractor_role"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "rounding_adjustment_cents"
  | "currency"
  | "content_revision"
  | "calc_snapshot_content_revision"
  | "status"
> & {
  estimate_projects: EmbeddedProject | EmbeddedProject[] | null;
};

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
};

type VersionAccess = {
  version: VersionWithProject;
  project: EmbeddedProject;
};

type PdfReadyPayload = {
  status: "ready";
  download_url: string;
  file_path: string;
  sha256_hash: string;
  file_size_bytes: number;
  generated_at: string;
};

type PdfStatusPayload =
  | {
      status: "missing";
    }
  | {
      status: "processing";
      last_error?: string;
    }
  | {
      status: "failed";
      last_error?: string;
    }
  | {
      status: "ready";
      download_url: string;
      file_path: string;
      sha256_hash?: string;
      generated_at?: string;
      file_size_bytes?: number;
    };

type PdfIssuer = {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

const ESTIMATE_DOCUMENTS_BUCKET = "estimate-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const businessPdfStyles = StyleSheet.create({
  page: {
    paddingTop: BUSINESS_DOCUMENT_THEME.page.topPaddingPt,
    paddingBottom: BUSINESS_DOCUMENT_THEME.page.bottomPaddingPt,
    paddingLeft: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt + 8,
    paddingRight: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt,
    fontSize: 9.5,
    lineHeight: 1.35,
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
    fontFamily: "Helvetica",
  },
  accentBlue: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 9,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
  },
  accentOrange: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 9,
    height: 92,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandOrange,
  },
  brandRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    height: 62,
    marginBottom: 16,
  },
  brandLogo: {
    width: 142,
    height: 58,
    objectFit: "contain",
  },
  establishmentCard: {
    width: 172,
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
    textAlign: "right",
    fontSize: 8.5,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
  establishmentTitle: {
    fontSize: 7.5,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  titleGrid: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  issuer: {
    width: "31%",
    fontSize: 8.5,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
  issuerLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  issuerName: {
    fontSize: 13,
    fontWeight: 700,
    color: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    marginBottom: 2,
  },
  documentTitleBlock: {
    width: "38%",
    alignItems: "center",
    minHeight: 74,
    paddingTop: 6,
  },
  documentTitle: {
    fontSize: 23,
    fontWeight: 700,
    lineHeight: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  versionBadge: {
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
    alignItems: "center",
    minWidth: 86,
  },
  versionBadgeText: {
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
    fontSize: 8,
    lineHeight: 1.2,
  },
  versionAccent: {
    color: BUSINESS_DOCUMENT_THEME.colors.brandOrange,
    fontWeight: 700,
  },
  infoGrid: {
    display: "flex",
    flexDirection: "row",
    columnGap: 18,
    marginBottom: 18,
  },
  infoCard: {
    width: "50%",
    minHeight: 92,
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 9,
    padding: 12,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
  },
  infoCardTitle: {
    textAlign: "center",
    fontSize: 7.5,
    fontWeight: 700,
    textTransform: "uppercase",
    color: BUSINESS_DOCUMENT_THEME.colors.brandOrange,
    marginBottom: 8,
  },
  clientName: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 7,
    fontWeight: 700,
    textTransform: "uppercase",
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 9,
    fontWeight: 700,
    marginBottom: 5,
  },
  infoRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  table: {
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 8,
    overflow: "hidden",
  },
  tableHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 7,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    color: BUSINESS_DOCUMENT_THEME.colors.white,
    fontSize: 7.5,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    borderTop: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
  },
  sectionLevel1: {
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    color: BUSINESS_DOCUMENT_THEME.colors.white,
  },
  sectionLevel2: {
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surfaceStrong,
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
  },
  sectionLevel3: {
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.white,
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
    borderLeft: `4px solid ${BUSINESS_DOCUMENT_THEME.colors.brandOrange}`,
  },
  sectionLevel4: {
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
  },
  sectionText: {
    fontSize: 8,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  lineText: {
    fontSize: 8.5,
  },
  numericText: {
    textAlign: "right",
  },
  centeredText: {
    textAlign: "center",
  },
  conditionsCard: {
    marginTop: 14,
    borderLeft: `5px solid ${BUSINESS_DOCUMENT_THEME.colors.brandOrange}`,
    borderRadius: 7,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fff7ed",
  },
  conditionsTitle: {
    fontSize: 8,
    fontWeight: 700,
    textTransform: "uppercase",
    color: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    marginBottom: 5,
  },
  conditionsText: {
    fontSize: 8.5,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
  continuationTitle: {
    fontSize: 18,
    fontWeight: 700,
    textTransform: "uppercase",
    paddingBottom: 8,
    marginBottom: 16,
    borderBottom: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
  },
  termsNotice: {
    marginBottom: 12,
    border: "1px solid #f59e0b",
    borderRadius: 5,
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: "#fffbeb",
    color: "#78350f",
    fontSize: 8.5,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  vatReverseChargeNotice: {
    marginTop: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderLeft: `3px solid ${BUSINESS_DOCUMENT_THEME.colors.brandOrange}`,
    backgroundColor: "#fff7ed",
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
    fontSize: 8,
  },
  termsColumns: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  termsColumn: {
    width: "48%",
  },
  termsClause: {
    marginBottom: 10,
  },
  termsClauseHeading: {
    fontSize: 9.1,
    fontWeight: 700,
    textTransform: "uppercase",
    color: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    marginBottom: 2.5,
  },
  termsClauseText: {
    fontSize: 9.2,
    lineHeight: 1.45,
    color: BUSINESS_DOCUMENT_THEME.colors.ink,
  },
  termsMeta: {
    marginTop: 10,
    fontSize: 8,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
  footer: {
    position: "absolute",
    left: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt + 8,
    right: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt,
    bottom: 28,
    borderTop: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    paddingTop: 6,
    fontSize: 7.5,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
    textAlign: "center",
    textTransform: "uppercase",
  },
  pageNumberWrapper: {
    position: "absolute",
    right: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt,
    top: 827,
  },
  pageNumber: {
    fontSize: 7,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
});

const changelogStyles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 24,
    fontSize: 9,
    color: "#0f172a",
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 12,
  },
  summaryGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 8,
    marginBottom: 12,
  },
  summaryCard: {
    width: "31%",
    minHeight: 44,
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#f8fafc",
  },
  summaryLabel: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 11,
    fontWeight: 700,
    color: "#0f172a",
  },
  sectionCard: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    marginBottom: 10,
    overflow: "hidden",
  },
  sectionHeader: {
    backgroundColor: "#eef2ff",
    paddingVertical: 6,
    paddingHorizontal: 8,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #cbd5e1",
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: "#1e3a8a",
  },
  sectionDelta: {
    fontSize: 9,
    fontWeight: 700,
    color: "#334155",
  },
  sectionBody: {
    padding: 8,
    display: "flex",
    flexDirection: "column",
    rowGap: 8,
  },
  changeCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: 6,
    backgroundColor: "#ffffff",
  },
  changeHeader: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
    columnGap: 8,
  },
  changeType: {
    fontSize: 8,
    color: "#475569",
    marginBottom: 2,
  },
  changeDesignation: {
    fontSize: 10,
    fontWeight: 700,
    color: "#0f172a",
  },
  changeDelta: {
    fontSize: 9,
    fontWeight: 700,
    color: "#0f172a",
    textAlign: "right",
  },
  fieldTable: {
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    overflow: "hidden",
  },
  fieldRow: {
    display: "flex",
    flexDirection: "row",
    borderTop: "1px solid #e2e8f0",
  },
  fieldHeadRow: {
    borderTop: "none",
    backgroundColor: "#f8fafc",
    fontWeight: 700,
  },
  fieldColLabel: {
    width: "32%",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRight: "1px solid #e2e8f0",
  },
  fieldColBefore: {
    width: "34%",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRight: "1px solid #e2e8f0",
  },
  fieldColAfter: {
    width: "34%",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  fieldHeadText: {
    fontSize: 8,
    color: "#475569",
    fontWeight: 700,
  },
  fieldBodyText: {
    fontSize: 8.5,
    color: "#0f172a",
  },
  emptyState: {
    fontSize: 8.5,
    color: "#64748b",
  },
});

const CHANGELOG_NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 3,
});

const CHANGELOG_PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatQuantity(value: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 3,
  }).format(value ?? 0);
}

function formatPercent(bp: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(bp / 100);
}

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string,
): Promise<VersionAccess> {
  let { data, error } = await context.supabase
    .from("estimate_versions")
    .select(VERSION_ACCESS_SELECT)
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (isMissingEstimateRoundingAdjustmentSchema(error)) {
    const legacyResult = await context.supabase
      .from("estimate_versions")
      .select(LEGACY_VERSION_ACCESS_SELECT)
      .eq("id", versionId)
      .eq("tenant_id", context.tenantId)
      .single();

    data = legacyResult.data
      ? { ...legacyResult.data, rounding_adjustment_cents: 0 }
      : null;
    error = legacyResult.error;
  }

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionWithProject;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (!project || project.tenant_id !== context.tenantId) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version,
    project,
  };
}

async function loadItems(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les lignes du chiffrage.",
    );
  }

  return (data ?? []) as EstimateItemRow[];
}

async function loadLaborRatesByRoleId(input: {
  supabase: Supabase;
  tenantId: string;
  roleIds: string[];
}) {
  if (input.roleIds.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id, hourly_rate_cents")
    .eq("tenant_id", input.tenantId)
    .in("id", input.roleIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les roles MO.");
  }

  const rates = new Map<string, number>();
  ((data ?? []) as LaborRoleRate[]).forEach((role) => {
    rates.set(role.id, role.hourly_rate_cents ?? 0);
  });
  return rates;
}

async function loadEstimateTermsTemplate(input: {
  supabase: Supabase;
  tenantId: string;
}): Promise<EstimateTermsTemplate | null> {
  const { data, error } = await input.supabase
    .from("estimate_terms_templates")
    .select(
      "id, tenant_id, title, body, version, policy, is_active, legal_reviewed_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    if (isMissingEstimateTermsSchema(error)) {
      return createDevelopmentEstimateTermsTemplate(input.tenantId);
    }

    throw mapSupabaseError(
      error,
      "Impossible de charger les conditions generales du devis.",
    );
  }
  if (!data) {
    return createDevelopmentEstimateTermsTemplate(input.tenantId);
  }

  const row = data as EstimateTermsTemplateRow;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title.trim(),
    body: row.body.trim(),
    version: row.version,
    policy: row.policy,
    legalReviewedAt: row.legal_reviewed_at,
  };
}

function normalizedSupabaseError(error: SupabaseErrorLike) {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isMissingEstimateRoundingAdjustmentSchema(
  error: SupabaseErrorLike | null | undefined,
) {
  if (!error) return false;
  const code = error.code?.toUpperCase() ?? "";
  const message = normalizedSupabaseError(error);

  return (
    code === "42703" &&
    message.includes("rounding_adjustment_cents") &&
    message.includes("estimate_versions")
  );
}

function isMissingEstimateTermsSchema(error: SupabaseErrorLike) {
  const code = error.code?.toUpperCase() ?? "";
  const message = normalizedSupabaseError(error);

  return (
    message.includes("estimate_terms_templates") &&
    (code === "42P01" ||
      code === "PGRST205" ||
      message.includes("schema cache"))
  );
}

async function loadPdfIssuer(input: {
  supabase: Supabase;
  userId: string;
}): Promise<PdfIssuer> {
  const { data } = await input.supabase
    .from("profiles")
    .select("full_name, job_title, phone, work_email")
    .eq("id", input.userId)
    .maybeSingle();
  const issuerDisplay = normalizeDocumentIssuerDisplay({
    issuerName: data?.full_name,
    issuerRole: data?.job_title,
    issuerEmail: data?.work_email,
    fallbackName: COMPANY_INFO.name,
  });

  return {
    name: issuerDisplay.displayName,
    role: issuerDisplay.displayRole || null,
    phone: data?.phone?.trim() || null,
    email: issuerDisplay.displayEmail || null,
  };
}

async function loadLogoDataUri() {
  try {
    const logoPath = path.join(
      process.cwd(),
      "public",
      "logo-hydro-express.jpg",
    );
    const bytes = await readFile(logoPath);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function createSignedUrlOrThrow(input: {
  supabase: Supabase;
  filePath: string;
}) {
  const { data, error } = await input.supabase.storage
    .from(ESTIMATE_DOCUMENTS_BUCKET)
    .createSignedUrl(input.filePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    const failure = classifyEstimatePdfStorageFailure(
      error ?? new Error("Missing signed PDF URL."),
      "sign",
    );
    throw internalError(
      failure.message,
      { reason: failure.reason },
      "PDF_GENERATION_FAILED",
    );
  }

  return data.signedUrl;
}

async function getDocumentRow(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_documents")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le document PDF.");
  }

  return (data ?? null) as EstimateDocumentRow | null;
}

function resolveGenerationPurpose(
  options: PdfGenerateOptions,
): EstimatePdfGenerationPurpose {
  if (options.triggeredBy !== "send") return "manual";
  return options.dispatchId ? "email" : "workflow";
}

function PdfPageChrome() {
  const registeredOfficeLabel = `${COMPANY_INFO.registeredOffice.street} ${COMPANY_INFO.registeredOffice.postalCode} ${COMPANY_INFO.registeredOffice.city}`;
  return (
    <>
      <View style={businessPdfStyles.accentBlue} fixed />
      <View style={businessPdfStyles.accentOrange} fixed />
      <View style={businessPdfStyles.footer} fixed>
        <Text>Siège social : {registeredOfficeLabel}</Text>
        <Text>
          SIRET {COMPANY_INFO.legal.siret} - TVA {COMPANY_INFO.legal.vat}
        </Text>
      </View>
      <View style={businessPdfStyles.pageNumberWrapper} fixed>
        <Text
          style={businessPdfStyles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} / ${totalPages}`
          }
        />
      </View>
    </>
  );
}

function PdfBrandHeader({
  logoDataUri,
}: Readonly<{ logoDataUri: string | null }>) {
  return (
    <View style={businessPdfStyles.brandRow} wrap={false}>
      {logoDataUri ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image style={businessPdfStyles.brandLogo} src={logoDataUri} />
      ) : (
        <View />
      )}
      <View style={businessPdfStyles.establishmentCard}>
        <Text style={businessPdfStyles.establishmentTitle}>
          Etablissement principal :
        </Text>
        <Text>{COMPANY_INFO.address.street}</Text>
        <Text>
          {COMPANY_INFO.address.postalCode} {COMPANY_INFO.address.city}
        </Text>
        <Text>{COMPANY_INFO.phone.landline}</Text>
        <Text>{COMPANY_INFO.phone.mobile}</Text>
      </View>
    </View>
  );
}

function getPdfColumnWidths(priceMode: EstimatePdfLayoutOptions["priceMode"]) {
  if (priceMode === "fo_mo_and_total") {
    return {
      designation: "41%",
      quantity: "8%",
      unit: "7%",
      fo: "14%",
      mo: "14%",
      total: "16%",
    };
  }
  if (priceMode === "unit_and_total") {
    return {
      designation: "50%",
      quantity: "9%",
      unit: "8%",
      unitPrice: "15%",
      total: "18%",
    };
  }
  return { designation: "64%", quantity: "10%", unit: "8%", total: "18%" };
}

function PdfEstimateTable({
  prepared,
  currency,
}: Readonly<{
  prepared: EstimateDocumentPreparedData;
  currency: ReturnType<typeof normalizeEstimateCurrency>;
}>) {
  const resolvedCurrency = currency ?? "EUR";
  const { layout } = prepared;
  const widths = getPdfColumnWidths(layout.priceMode);
  const rowPadding =
    layout.density === "compact"
      ? 3.5
      : layout.density === "comfortable"
        ? 7
        : 5;

  return (
    <View style={businessPdfStyles.table}>
      <View style={businessPdfStyles.tableHeader} fixed>
        <Text style={{ width: widths.designation }}>Designation</Text>
        <Text
          style={[businessPdfStyles.centeredText, { width: widths.quantity }]}
        >
          Qte
        </Text>
        <Text style={[businessPdfStyles.centeredText, { width: widths.unit }]}>
          U
        </Text>
        {layout.priceMode === "unit_and_total" ? (
          <Text
            style={[businessPdfStyles.numericText, { width: widths.unitPrice }]}
          >
            P.U. HT
          </Text>
        ) : null}
        {layout.priceMode === "fo_mo_and_total" ? (
          <>
            <Text style={[businessPdfStyles.numericText, { width: widths.fo }]}>
              FO HT
            </Text>
            <Text style={[businessPdfStyles.numericText, { width: widths.mo }]}>
              MO HT
            </Text>
          </>
        ) : null}
        <Text style={[businessPdfStyles.numericText, { width: widths.total }]}>
          Total HT
        </Text>
      </View>

      {prepared.rows.map(({ item, depth }) => {
        const title = item.title?.trim() || "Sans titre";
        const titlePrefix =
          layout.showNumbering && prepared.numberingById[item.id]
            ? `${prepared.numberingById[item.id]}  `
            : "";
        const designationStyle = {
          width: widths.designation,
          paddingLeft: Math.min(depth, 4) * 9,
        };

        if (item.item_type === "section") {
          const totals = prepared.sectionTotalsById[item.id];
          const subtotal = layout.showSectionSubtotals ? totals : null;
          const levelStyle =
            depth === 0
              ? businessPdfStyles.sectionLevel1
              : depth === 1
                ? businessPdfStyles.sectionLevel2
                : depth === 2
                  ? businessPdfStyles.sectionLevel3
                  : businessPdfStyles.sectionLevel4;

          return (
            <View
              key={item.id}
              style={[
                businessPdfStyles.tableRow,
                levelStyle,
                { paddingVertical: rowPadding },
              ]}
              wrap={false}
            >
              <Text style={[businessPdfStyles.sectionText, designationStyle]}>
                {titlePrefix}
                {title}
              </Text>
              <Text
                style={[
                  businessPdfStyles.centeredText,
                  { width: widths.quantity },
                ]}
              >
                {""}
              </Text>
              <Text
                style={[businessPdfStyles.centeredText, { width: widths.unit }]}
              >
                {""}
              </Text>
              {layout.priceMode === "unit_and_total" ? (
                <Text
                  style={[
                    businessPdfStyles.numericText,
                    { width: widths.unitPrice },
                  ]}
                >
                  {""}
                </Text>
              ) : null}
              {layout.priceMode === "fo_mo_and_total" ? (
                <>
                  <Text
                    style={[
                      businessPdfStyles.numericText,
                      { width: widths.fo },
                    ]}
                  >
                    {subtotal
                      ? formatCurrency(subtotal.foTotalCents, resolvedCurrency)
                      : ""}
                  </Text>
                  <Text
                    style={[
                      businessPdfStyles.numericText,
                      { width: widths.mo },
                    ]}
                  >
                    {subtotal
                      ? formatCurrency(subtotal.moTotalCents, resolvedCurrency)
                      : ""}
                  </Text>
                </>
              ) : null}
              <Text
                style={[
                  businessPdfStyles.numericText,
                  { width: widths.total, fontWeight: 700 },
                ]}
              >
                {subtotal
                  ? formatCurrency(subtotal.totalHtCents, resolvedCurrency)
                  : ""}
              </Text>
            </View>
          );
        }

        const split = prepared.lineSplitsById[item.id] ?? {
          foTotalCents: item.line_total_ht_cents ?? 0,
          moTotalCents: 0,
          totalHtCents: item.line_total_ht_cents ?? 0,
        };

        return (
          <View
            key={item.id}
            style={[
              businessPdfStyles.tableRow,
              { paddingVertical: rowPadding },
            ]}
            wrap={false}
          >
            <Text style={[businessPdfStyles.lineText, designationStyle]}>
              {title}
            </Text>
            <Text
              style={[
                businessPdfStyles.centeredText,
                { width: widths.quantity },
              ]}
            >
              {formatQuantity(item.quantity)}
            </Text>
            <Text
              style={[businessPdfStyles.centeredText, { width: widths.unit }]}
            >
              {item.description?.trim() || "-"}
            </Text>
            {layout.priceMode === "unit_and_total" ? (
              <Text
                style={[
                  businessPdfStyles.numericText,
                  { width: widths.unitPrice },
                ]}
              >
                {formatCurrency(
                  prepared.lineUnitPriceHtById[item.id] ??
                    item.pu_ht_cents ??
                    0,
                  resolvedCurrency,
                )}
              </Text>
            ) : null}
            {layout.priceMode === "fo_mo_and_total" ? (
              <>
                <Text
                  style={[businessPdfStyles.numericText, { width: widths.fo }]}
                >
                  {formatCurrency(split.foTotalCents, resolvedCurrency)}
                </Text>
                <Text
                  style={[businessPdfStyles.numericText, { width: widths.mo }]}
                >
                  {formatCurrency(split.moTotalCents, resolvedCurrency)}
                </Text>
              </>
            ) : null}
            <Text
              style={[
                businessPdfStyles.numericText,
                { width: widths.total, fontWeight: 700 },
              ]}
            >
              {formatCurrency(split.totalHtCents, resolvedCurrency)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function PdfConditions({
  text,
  showTitle = true,
}: Readonly<{ text: string; showTitle?: boolean }>) {
  return (
    <View style={businessPdfStyles.conditionsCard} wrap={false}>
      {showTitle ? (
        <Text style={businessPdfStyles.conditionsTitle}>
          {ESTIMATE_SERVICE_LIMITS_TITLE}
        </Text>
      ) : null}
      <Text style={businessPdfStyles.conditionsText}>{text}</Text>
    </View>
  );
}

export function buildEstimatePdfDocument(input: {
  logoDataUri: string | null;
  project: EmbeddedProject;
  version: VersionWithProject;
  issuer: PdfIssuer;
  prepared: EstimateDocumentPreparedData;
  terms: EstimateTermsSnapshot | null;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
  roundingAdjustmentCents: number;
}) {
  const currency = normalizeEstimateCurrency(input.version.currency) ?? "EUR";
  const vatReverseCharge =
    input.version.contractor_role === "subcontractor";
  const formattedEstimateReference = formatEstimateReference(
    input.project.estimate_reference,
    input.version.version_number,
  );
  const conditionsText = input.version.exclusions?.trim() ?? "";
  const conditionsOnNewPage =
    conditionsText.length > 0 &&
    input.prepared.layout.conditionsPlacement === "new_page";
  const termsColumns = input.terms
    ? splitEstimateTermsClauses(parseEstimateTermsClauses(input.terms.body))
    : [[], []];
  const termsReviewLabel = input.terms
    ? input.terms.isDraft || !input.terms.legalReviewedAt
      ? `Maquette CGV - version ${input.terms.version} - à valider, non contractuelle.`
      : `Version des conditions : ${input.terms.version} - revue juridique du ${formatDate(
          input.terms.legalReviewedAt,
        )}`
    : null;

  return (
    <Document>
      <Page size="A4" style={businessPdfStyles.page} wrap>
        <PdfPageChrome />
        <PdfBrandHeader logoDataUri={input.logoDataUri} />

        <View style={businessPdfStyles.titleGrid}>
          <View style={businessPdfStyles.issuer}>
            <Text style={businessPdfStyles.issuerLabel}>Emis par</Text>
            <Text style={businessPdfStyles.issuerName}>
              {input.issuer.name}
            </Text>
            {input.issuer.role ? <Text>{input.issuer.role}</Text> : null}
            {input.issuer.phone ? <Text>{input.issuer.phone}</Text> : null}
            {input.issuer.email ? <Text>{input.issuer.email}</Text> : null}
            <Text>Le {formatDate(input.version.date_devis)}</Text>
          </View>
          <View style={businessPdfStyles.documentTitleBlock}>
            <Text style={businessPdfStyles.documentTitle}>Devis</Text>
            <View style={businessPdfStyles.versionBadge} wrap={false}>
              <Text style={businessPdfStyles.versionBadgeText}>
                Version :{" "}
                <Text style={businessPdfStyles.versionAccent}>
                  V{input.version.version_number}
                </Text>
              </Text>
            </View>
          </View>
          <View style={{ width: "31%" }} />
        </View>

        <View style={businessPdfStyles.infoGrid}>
          <View style={businessPdfStyles.infoCard}>
            <Text style={businessPdfStyles.infoCardTitle}>Client</Text>
            <Text style={businessPdfStyles.clientName}>
              {input.project.client_name?.trim() || "Client a renseigner"}
            </Text>
            <Text style={businessPdfStyles.fieldLabel}>Affaire</Text>
            <Text style={businessPdfStyles.fieldValue}>
              {input.project.name}
            </Text>
            {formattedEstimateReference ? (
              <Text>Reference devis : {formattedEstimateReference}</Text>
            ) : null}
            {input.project.reference ? (
              <Text>Reference projet : {input.project.reference}</Text>
            ) : null}
          </View>
          <View style={businessPdfStyles.infoCard}>
            <Text style={businessPdfStyles.infoCardTitle}>
              Informations devis
            </Text>
            <View style={businessPdfStyles.infoRow}>
              <Text>Date du devis</Text>
              <Text style={{ fontWeight: 700 }}>
                {formatDate(input.version.date_devis)}
              </Text>
            </View>
            <View style={businessPdfStyles.infoRow}>
              <Text>Validite</Text>
              <Text style={{ fontWeight: 700 }}>
                {input.version.validite_jours} jours
              </Text>
            </View>
            {vatReverseCharge ? (
              <View style={businessPdfStyles.infoRow}>
                <Text>Régime fiscal</Text>
                <Text style={{ fontWeight: 700 }}>Autoliquidation</Text>
              </View>
            ) : (
              <View style={businessPdfStyles.infoRow}>
                <Text>TVA</Text>
                <Text style={{ fontWeight: 700 }}>
                  {formatPercent(input.version.tax_rate_bp)} %
                </Text>
              </View>
            )}
          </View>
        </View>

        <PdfEstimateTable prepared={input.prepared} currency={currency} />

        <PdfEstimateTotalsCard
          totalHtCents={input.totalHtCents}
          totalTaxCents={input.totalTaxCents}
          amountDueCents={input.totalTtcCents}
          roundingAdjustmentCents={input.roundingAdjustmentCents}
          currency={currency}
          taxRateBp={input.version.tax_rate_bp}
          vatReverseCharge={vatReverseCharge}
        />
        {vatReverseCharge ? (
          <Text style={businessPdfStyles.vatReverseChargeNotice}>
            {ESTIMATE_VAT_REVERSE_CHARGE_NOTICE}
          </Text>
        ) : null}

        {conditionsText && !conditionsOnNewPage ? (
          <PdfConditions text={conditionsText} />
        ) : null}
      </Page>

      {conditionsOnNewPage ? (
        <Page size="A4" style={businessPdfStyles.page} wrap>
          <PdfPageChrome />
          <PdfBrandHeader logoDataUri={input.logoDataUri} />
          <Text style={businessPdfStyles.continuationTitle}>
            {ESTIMATE_SERVICE_LIMITS_TITLE}
          </Text>
          <PdfConditions text={conditionsText} showTitle={false} />
        </Page>
      ) : null}

      {input.prepared.layout.includeTerms && input.terms ? (
        <Page size="A4" style={businessPdfStyles.page} wrap>
          <PdfPageChrome />
          <PdfBrandHeader logoDataUri={input.logoDataUri} />
          <Text style={businessPdfStyles.continuationTitle}>
            {input.terms.title}
          </Text>
          {input.terms.isDraft ? (
            <Text style={businessPdfStyles.termsNotice}>
              {ESTIMATE_DRAFT_TERMS_NOTICE}
            </Text>
          ) : null}
          <View style={businessPdfStyles.termsColumns}>
            {termsColumns.map((column, columnIndex) => (
              <View key={columnIndex} style={businessPdfStyles.termsColumn}>
                {column.map((clause, clauseIndex) => (
                  <View
                    key={[columnIndex, clauseIndex, clause.heading].join("-")}
                    style={businessPdfStyles.termsClause}
                    wrap={false}
                  >
                    {clause.heading ? (
                      <Text style={businessPdfStyles.termsClauseHeading}>
                        {clause.heading}
                      </Text>
                    ) : null}
                    <Text style={businessPdfStyles.termsClauseText}>
                      {clause.text}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <Text style={businessPdfStyles.termsMeta}>{termsReviewLabel}</Text>
        </Page>
      ) : null}
    </Document>
  );
}

export async function markEstimatePdfProcessing(
  versionId: string,
): Promise<EstimatePdfGenerationClaim> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);
  assertEstimatePdfMutationAllowed(access.version.status, "manual");
  const publicationClient = createServiceRoleClient();

  return beginEstimatePdfGeneration({
    client: publicationClient,
    versionId,
    tenantId: context.tenantId,
    actorUserId: context.userId,
    purpose: "manual",
  });
}

export async function markEstimatePdfFailed(
  versionId: string,
  message: string,
  claim: EstimatePdfGenerationClaim,
): Promise<void> {
  const context = await getAuthenticatedContext();
  await getVersionAccessOrThrow(context, versionId);
  const publicationClient = createServiceRoleClient();

  await failEstimatePdfGeneration({
    client: publicationClient,
    versionId,
    tenantId: context.tenantId,
    actorUserId: context.userId,
    claim,
    message,
  });
}

export async function generateEstimatePdfNow(
  versionId: string,
  options: PdfGenerateOptions = {},
): Promise<PdfReadyPayload> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);

  const existing = await getDocumentRow({
    supabase: context.supabase,
    tenantId: context.tenantId,
    versionId,
  });
  if (
    !options.force &&
    existing?.status === "ready" &&
    existing.last_error === null &&
    existing.published_content_revision === access.version.content_revision &&
    existing.file_path &&
    isCanonicalEstimatePdfPath({
      filePath: existing.file_path,
      tenantId: context.tenantId,
      projectId: access.project.id,
      versionId,
      sha256Hash: existing.sha256_hash,
    }) &&
    existing.generated_at
  ) {
    const downloadUrl = await createSignedUrlOrThrow({
      supabase: context.supabase,
      filePath: existing.file_path,
    });

    return {
      status: "ready",
      download_url: downloadUrl,
      file_path: existing.file_path,
      sha256_hash: existing.sha256_hash ?? "",
      file_size_bytes: Number(existing.file_size_bytes ?? 0),
      generated_at: existing.generated_at,
    };
  }

  if (!options.publicationClaim) {
    assertEstimatePdfMutationAllowed(access.version.status, options.triggeredBy);
  }

  // Mutations are deliberately service-role-only in SQL and Storage. Failing
  // here when server configuration is absent prevents an impossible fallback
  // to the authenticated client from being mistaken for a supported path.
  const publicationClient = createServiceRoleClient();
  const storageClient = publicationClient;

  const claim =
    options.publicationClaim ??
    (await beginEstimatePdfGeneration({
      client: publicationClient,
      versionId,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      purpose: resolveGenerationPurpose(options),
      dispatchId: options.dispatchId,
    }));

  try {
    const [items, termsTemplate, issuer, logoDataUri] = await Promise.all([
      loadItems({
        supabase: context.supabase,
        tenantId: context.tenantId,
        versionId,
      }),
      loadEstimateTermsTemplate({
        supabase: context.supabase,
        tenantId: context.tenantId,
      }),
      loadPdfIssuer({
        supabase: context.supabase,
        userId: context.userId,
      }),
      loadLogoDataUri(),
    ]);
    const termsConfiguration = toEstimatePdfTermsConfiguration(termsTemplate);
    const storedLayout = normalizeEstimatePdfLayoutOptions(
      existing?.layout_options ?? DEFAULT_ESTIMATE_PDF_LAYOUT,
    );
    const requestedLayout = normalizeEstimatePdfLayoutOptions(
      options.layout ?? storedLayout,
    );
    const effectiveLayout = applyEstimateTermsPolicy(
      requestedLayout,
      termsConfiguration,
    );
    const parsedStoredTermsSnapshot = parseEstimateTermsSnapshot(
      existing?.terms_snapshot,
    );
    const storedTermsSnapshot =
      parsedStoredTermsSnapshot &&
      canUseEstimateTermsSnapshot(parsedStoredTermsSnapshot)
        ? parsedStoredTermsSnapshot
        : null;
    const termsSnapshot = effectiveLayout.includeTerms
      ? (storedTermsSnapshot ??
        (termsTemplate ? createEstimateTermsSnapshot(termsTemplate) : null))
      : storedTermsSnapshot;
    const lineItems = items.filter((item) => item.item_type === "line");
    const calcEngineVersion = resolveCalcEngineVersion(access.version);
    const preserveStoredSnapshot =
      shouldPreserveStoredEstimateV2Snapshot(access.version);

    const laborRoleIds = preserveStoredSnapshot ? [] : Array.from(
      new Set(
        lineItems
          .flatMap((item) => [
            item.labor_role_id,
            item.labor_role_atelier_id,
            item.labor_role_chantier_id,
          ])
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const laborRatesByRoleId = await loadLaborRatesByRoleId({
      supabase: context.supabase,
      tenantId: context.tenantId,
      roleIds: laborRoleIds,
    });

    const lineItemsForTotals = lineItems.map((item) => ({
      ...item,
      labor_role_hourly_rate_cents: item.labor_role_id
        ? (laborRatesByRoleId.get(item.labor_role_id) ?? 0)
        : 0,
      labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
        ? (laborRatesByRoleId.get(item.labor_role_atelier_id) ?? 0)
        : 0,
      labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
        ? (laborRatesByRoleId.get(item.labor_role_chantier_id) ?? 0)
        : 0,
    }));

    // EST-E26 (T6, étape 5) : le PDF respecte le flag tenant réel au lieu du
    // `isLaborSplitEnabled: false` codé en dur, pour être cohérent avec l'écran.
    const isLaborSplitEnabled = preserveStoredSnapshot
      ? true
      : await isFeatureEnabled(context.tenantId, "EST_031_LABOR_SPLIT", {
          supabase: context.supabase,
        });

    // EST-E26 (T6, étape 6) : barème du tenant injecté (marginTiers requis).
    // Hors brouillon, le mode est figé : le PDF d’un devis transmis reproduit la
    // marge persistée, pas le barème du jour (cf. resolveRenderMarginMode).
    const renderMarginMode = resolveRenderMarginMode(
      access.version.status,
      access.version.margin_mode
    );
    const marginTiers =
      !preserveStoredSnapshot && renderMarginMode === "tiered"
        ? await loadMarginTiersForTotals({
            supabase: context.supabase,
            tenantId: access.version.tenant_id,
          })
        : [];

    const vatReverseCharge =
      access.version.contractor_role === "subcontractor";
    const storedBreakdown = preserveStoredSnapshot
      ? buildLegacyDocumentBreakdown({
          items,
          marginMultiplier: access.version.margin_multiplier,
          discountCents: 0,
          taxRateBp: access.version.tax_rate_bp,
          isLaborSplitEnabled: true,
          laborRateById: {},
          calcEngineVersion,
          globalCoefficient: access.version.global_coefficient,
          preserveStoredSnapshot: true,
          versionTotals: {
            total_ht_cents: access.version.total_ht_cents,
            total_tax_cents:
              access.version.total_tax_cents -
              access.version.rounding_adjustment_cents,
            total_ttc_cents: access.version.total_ttc_cents,
            rounding_adjustment_cents:
              access.version.rounding_adjustment_cents,
          },
        })
      : null;
    const computedTotals =
      storedBreakdown?.totals ??
      (() => {
        const baseTotals = computeEstimateTotals({
          lineItems: lineItemsForTotals,
          marginMultiplier: access.version.margin_multiplier,
          marginMode: renderMarginMode,
          marginTiers,
          isLaborSplitEnabled,
          discountCents: 0,
          discountMode: access.version.discount_mode,
          discountStepsBp: access.version.discount_steps,
          globalCoefficient: access.version.global_coefficient,
          taxRateBp: access.version.tax_rate_bp,
          roundingMode: access.version.rounding_mode,
          roundingStepCents: access.version.rounding_step_cents,
          vatReverseCharge,
        });
        const fallbackDiscountCents =
          baseTotals.saleSubtotalCents > 0
            ? Math.round(
                (baseTotals.saleSubtotalCents * access.version.discount_bp) /
                  10000,
              )
            : 0;
        return computeEstimateTotals({
          lineItems: lineItemsForTotals,
          marginMultiplier: access.version.margin_multiplier,
          marginMode: renderMarginMode,
          marginTiers,
          isLaborSplitEnabled,
          discountCents: fallbackDiscountCents,
          discountMode: access.version.discount_mode,
          discountStepsBp: access.version.discount_steps,
          globalCoefficient: access.version.global_coefficient,
          taxRateBp: access.version.tax_rate_bp,
          roundingMode: access.version.rounding_mode,
          roundingStepCents: access.version.rounding_step_cents,
          vatReverseCharge,
        });
      })();

    const totalHtCents = computedTotals.saleTotalCents;
    const totalTaxCents = computedTotals.taxCents;
    const totalTtcCents = computedTotals.roundedTtcCents;
    const roundingAdjustmentCents = computedTotals.roundingAdjustmentCents;

    const prepared = prepareEstimateDocumentData({
      items,
      // EST-E26 (T6, étape 12) : le PDF dérive du même breakdown que le document
      // écran — plus de recalcul parallèle des sections et des lignes.
      breakdown:
        storedBreakdown ??
        buildLegacyDocumentBreakdown({
          items,
          marginMultiplier: computedTotals.appliedMarginMultiplier,
          discountCents: computedTotals.discountCents,
          taxRateBp: access.version.tax_rate_bp,
          isLaborSplitEnabled,
          laborRateById: Object.fromEntries(laborRatesByRoleId.entries()),
          calcEngineVersion,
          globalCoefficient: access.version.global_coefficient,
        }),
      calcEngineVersion,
      vatReverseCharge,
      taxRateBp: access.version.tax_rate_bp,
      currency: access.version.currency,
      validiteJours: access.version.validite_jours,
      layout: effectiveLayout,
    });
    const pdfDocument = buildEstimatePdfDocument({
      logoDataUri,
      project: access.project,
      version: access.version,
      issuer,
      prepared,
      terms: termsSnapshot,
      totalHtCents,
      totalTaxCents,
      totalTtcCents,
      roundingAdjustmentCents,
    });

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderToBuffer(pdfDocument);
    } catch (error) {
      throw internalError("Impossible de generer le binaire PDF.", error);
    }

    const sha256Hash = createHash("sha256")
      .update(pdfBuffer)
      .digest("hex")
      .toLowerCase();
    const filePath = buildContentAddressedEstimatePdfPath({
      tenantId: context.tenantId,
      projectId: access.project.id,
      versionId,
      sha256Hash,
    });

    const { error: uploadError } = await storageClient.storage
      .from(ESTIMATE_DOCUMENTS_BUCKET)
      .upload(filePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (
      uploadError &&
      !isImmutableStorageObjectAlreadyPresent(uploadError)
    ) {
      const failure = classifyEstimatePdfStorageFailure(uploadError, "upload");
      throw internalError(
        failure.message,
        { reason: failure.reason },
        "PDF_GENERATION_FAILED",
      );
    }

    const generatedAt = new Date().toISOString();

    await publishEstimatePdfGeneration({
      client: publicationClient,
      versionId,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      claim,
      filePath,
      sha256Hash,
      fileSizeBytes: pdfBuffer.byteLength,
      generatedAt,
      layoutOptions: effectiveLayout as unknown as Json,
      termsSnapshot: termsSnapshot as unknown as Json | null,
    });

    const downloadUrl = await createSignedUrlOrThrow({
      supabase: context.supabase,
      filePath,
    });

    return {
      status: "ready",
      download_url: downloadUrl,
      file_path: filePath,
      sha256_hash: sha256Hash,
      file_size_bytes: pdfBuffer.byteLength,
      generated_at: generatedAt,
    };
  } catch (error) {
    try {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "Echec generation PDF";

      await failEstimatePdfGeneration({
        client: publicationClient,
        versionId,
        tenantId: context.tenantId,
        actorUserId: context.userId,
        claim,
        message,
      });
    } catch {
      // Best effort status update when generation fails.
    }

    throw error;
  }
}

export async function getEstimatePdfLayoutConfiguration(
  versionId: string,
): Promise<EstimatePdfLayoutConfiguration> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);
  const [items, termsTemplate] = await Promise.all([
    loadItems({
      supabase: context.supabase,
      tenantId: context.tenantId,
      versionId,
    }),
    loadEstimateTermsTemplate({
      supabase: context.supabase,
      tenantId: context.tenantId,
    }),
  ]);
  const structure = summarizeEstimateDocumentStructure(items);

  return {
    ...structure,
    hasConditions: Boolean(access.version.exclusions?.trim()),
    terms: toEstimatePdfTermsConfiguration(termsTemplate),
  };
}

export async function resolveEstimatePdfPreviewLayout(
  versionId: string,
  requestedLayout: EstimatePdfLayoutOptions,
) {
  const context = await getAuthenticatedContext();
  await getVersionAccessOrThrow(context, versionId);
  const [termsTemplate, existing] = await Promise.all([
    loadEstimateTermsTemplate({
      supabase: context.supabase,
      tenantId: context.tenantId,
    }),
    getDocumentRow({
      supabase: context.supabase,
      tenantId: context.tenantId,
      versionId,
    }),
  ]);
  const layout = applyEstimateTermsPolicy(
    normalizeEstimatePdfLayoutOptions(requestedLayout),
    toEstimatePdfTermsConfiguration(termsTemplate),
  );
  const parsedStoredTermsSnapshot = parseEstimateTermsSnapshot(
    existing?.terms_snapshot,
  );
  const storedTermsSnapshot =
    parsedStoredTermsSnapshot &&
    canUseEstimateTermsSnapshot(parsedStoredTermsSnapshot)
      ? parsedStoredTermsSnapshot
      : null;
  const terms = layout.includeTerms
    ? (storedTermsSnapshot ??
      (termsTemplate ? createEstimateTermsSnapshot(termsTemplate) : null))
    : null;

  return { layout, terms };
}

export async function getEstimatePdfStatus(
  versionId: string,
): Promise<PdfStatusPayload> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);

  const row = await getDocumentRow({
    supabase: context.supabase,
    tenantId: context.tenantId,
    versionId,
  });

  if (!row) {
    return {
      status: "missing",
    };
  }

  if (row.status === "processing") {
    return {
      status: "processing",
      last_error: row.last_error ?? undefined,
    };
  }

  if (row.status === "failed") {
    return {
      status: "failed",
      last_error: row.last_error ?? undefined,
    };
  }

  if (
    row.last_error !== null ||
    row.published_content_revision !== access.version.content_revision
  ) {
    return {
      status: "failed",
      last_error:
        row.last_error ??
        "Le document PDF ne correspond plus a la revision courante du devis.",
    };
  }

  if (!row.file_path) {
    return {
      status: "failed",
      last_error: "Chemin du document PDF manquant.",
    };
  }

  if (
    !isCanonicalEstimatePdfPath({
      filePath: row.file_path,
      tenantId: context.tenantId,
      projectId: access.project.id,
      versionId,
      sha256Hash: row.sha256_hash,
    })
  ) {
    return {
      status: "failed",
      last_error: "Chemin du document PDF non conforme.",
    };
  }

  const downloadUrl = await createSignedUrlOrThrow({
    supabase: context.supabase,
    filePath: row.file_path,
  });

  return {
    status: "ready",
    download_url: downloadUrl,
    file_path: row.file_path,
    sha256_hash: row.sha256_hash ?? undefined,
    generated_at: row.generated_at ?? undefined,
    file_size_bytes:
      row.file_size_bytes === null ? undefined : Number(row.file_size_bytes),
  };
}

function formatChangelogDelta(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatEUR(cents)}`;
}

function formatChangelogFieldValue(
  field: EstimateVersionChangelogField,
  value: string | number | null,
) {
  if (value === null) return "-";

  if (field.kind === "money") {
    if (typeof value !== "number") return value;
    return formatEUR(value);
  }

  if (field.kind === "percent") {
    if (typeof value !== "number") return value;
    return `${CHANGELOG_PERCENT_FORMATTER.format(value / 100)}%`;
  }

  if (field.kind === "number") {
    if (typeof value !== "number") return value;
    return CHANGELOG_NUMBER_FORMATTER.format(value);
  }

  return String(value);
}

function changelogChangeLabel(
  changeType: EstimateVersionChangelogChange["changeType"],
) {
  if (changeType === "added") return "Ajout";
  if (changeType === "removed") return "Suppression";
  return "Modification";
}

function changelogEntityLabel(
  entityType: EstimateVersionChangelogChange["entityType"],
) {
  if (entityType === "section") return "Section";
  return "Ligne";
}

function buildEstimateChangelogPdfDocument(input: {
  changelog: EstimateVersionChangelog;
  previousVersionLabel: string;
  currentVersionLabel: string;
}) {
  return (
    <Document>
      <Page size="A4" style={changelogStyles.page}>
        <Text style={changelogStyles.title}>Annexe - Changelog</Text>
        <Text style={changelogStyles.subtitle}>
          {input.previousVersionLabel} -&gt; {input.currentVersionLabel}
        </Text>

        <View style={changelogStyles.summaryGrid}>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Ajouts</Text>
            <Text style={changelogStyles.summaryValue}>
              {input.changelog.summary.addedCount}
            </Text>
          </View>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Suppressions</Text>
            <Text style={changelogStyles.summaryValue}>
              {input.changelog.summary.removedCount}
            </Text>
          </View>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Modifications</Text>
            <Text style={changelogStyles.summaryValue}>
              {input.changelog.summary.modifiedCount}
            </Text>
          </View>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Delta HT total</Text>
            <Text style={changelogStyles.summaryValue}>
              {formatChangelogDelta(input.changelog.summary.deltaHtCents)}
            </Text>
          </View>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Delta TTC total</Text>
            <Text style={changelogStyles.summaryValue}>
              {formatChangelogDelta(input.changelog.summary.deltaTtcCents)}
            </Text>
          </View>
          <View style={changelogStyles.summaryCard}>
            <Text style={changelogStyles.summaryLabel}>Lignes changelog</Text>
            <Text style={changelogStyles.summaryValue}>
              {input.changelog.summary.totalChangeCount}
            </Text>
          </View>
        </View>

        {input.changelog.sections.map((section) => (
          <View key={section.key} style={changelogStyles.sectionCard}>
            <View style={changelogStyles.sectionHeader}>
              <Text style={changelogStyles.sectionTitle}>{section.label}</Text>
              <Text style={changelogStyles.sectionDelta}>
                HT {formatChangelogDelta(section.deltaHtCents)} | TTC{" "}
                {formatChangelogDelta(section.deltaTtcCents)}
              </Text>
            </View>

            <View style={changelogStyles.sectionBody}>
              {section.changes.map((change) => (
                <View key={change.key} style={changelogStyles.changeCard}>
                  <View style={changelogStyles.changeHeader}>
                    <View>
                      <Text style={changelogStyles.changeType}>
                        {changelogChangeLabel(change.changeType)} -{" "}
                        {changelogEntityLabel(change.entityType)}
                      </Text>
                      <Text style={changelogStyles.changeDesignation}>
                        {change.designation}
                      </Text>
                    </View>
                    <Text style={changelogStyles.changeDelta}>
                      HT {formatChangelogDelta(change.deltaHtCents)}
                      {"\n"}
                      TTC {formatChangelogDelta(change.deltaTtcCents)}
                    </Text>
                  </View>

                  {change.fields.length > 0 ? (
                    <View style={changelogStyles.fieldTable}>
                      <View
                        style={[
                          changelogStyles.fieldRow,
                          changelogStyles.fieldHeadRow,
                        ]}
                      >
                        <View style={changelogStyles.fieldColLabel}>
                          <Text style={changelogStyles.fieldHeadText}>
                            Champ
                          </Text>
                        </View>
                        <View style={changelogStyles.fieldColBefore}>
                          <Text style={changelogStyles.fieldHeadText}>
                            {input.previousVersionLabel}
                          </Text>
                        </View>
                        <View style={changelogStyles.fieldColAfter}>
                          <Text style={changelogStyles.fieldHeadText}>
                            {input.currentVersionLabel}
                          </Text>
                        </View>
                      </View>

                      {change.fields.map((field) => (
                        <View
                          key={`${change.key}:${field.field}:${String(field.beforeValue)}:${String(field.afterValue)}`}
                          style={changelogStyles.fieldRow}
                        >
                          <View style={changelogStyles.fieldColLabel}>
                            <Text style={changelogStyles.fieldBodyText}>
                              {field.label}
                            </Text>
                          </View>
                          <View style={changelogStyles.fieldColBefore}>
                            <Text style={changelogStyles.fieldBodyText}>
                              {formatChangelogFieldValue(
                                field,
                                field.beforeValue,
                              )}
                            </Text>
                          </View>
                          <View style={changelogStyles.fieldColAfter}>
                            <Text style={changelogStyles.fieldBodyText}>
                              {formatChangelogFieldValue(
                                field,
                                field.afterValue,
                              )}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={changelogStyles.emptyState}>
                      Aucun detail champ disponible.
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderEstimateChangelogPdfBuffer(input: {
  changelog: EstimateVersionChangelog;
  previousVersionLabel: string;
  currentVersionLabel: string;
}): Promise<Buffer> {
  const document = buildEstimateChangelogPdfDocument(input);

  try {
    return await renderToBuffer(document);
  } catch (error) {
    throw internalError("Impossible de generer le PDF du changelog.", error);
  }
}
