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

import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { COMPANY_INFO } from "@/lib/company-info";
import { formatEUR } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

import {
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";
import type {
  EstimateVersionChangelog,
  EstimateVersionChangelogChange,
  EstimateVersionChangelogField,
} from "./changelog";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateDocumentRow = Database["public"]["Tables"]["estimate_documents"]["Row"];
type LaborRoleRate = Pick<
  Database["public"]["Tables"]["labor_roles"]["Row"],
  "id" | "hourly_rate_cents"
>;

type EmbeddedProject = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "reference" | "client_name"
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
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
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

type PdfGenerateOptions = {
  force?: boolean;
  triggeredBy?: "manual" | "send";
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

type FlattenedItem = {
  item: EstimateItemRow;
  depth: number;
};

const ESTIMATE_DOCUMENTS_BUCKET = "estimate-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 44,
    paddingHorizontal: 24,
    fontSize: 10,
    color: "#0f172a",
    fontFamily: "Helvetica",
  },
  headerRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  logo: {
    width: 124,
    height: 52,
    objectFit: "contain",
  },
  companyBlock: {
    textAlign: "right",
    fontSize: 9,
    color: "#475569",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  projectName: {
    fontSize: 12,
    fontWeight: 700,
    color: "#1e3a5f",
    marginBottom: 2,
  },
  projectSub: {
    fontSize: 10,
    color: "#334155",
    marginBottom: 10,
  },
  metaCard: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metaColumn: {
    width: "48%",
    display: "flex",
    flexDirection: "column",
    rowGap: 4,
  },
  metaRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  exclusionsCard: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  exclusionsTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: "#1e3a5f",
    marginBottom: 4,
  },
  exclusionsText: {
    fontSize: 9,
    color: "#334155",
  },
  table: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableHead: {
    backgroundColor: "#1e3a5f",
    color: "#ffffff",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
    fontWeight: 700,
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    borderTop: "1px solid #e2e8f0",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  sectionRow: {
    backgroundColor: "#f8fafc",
    fontWeight: 700,
    color: "#334155",
  },
  colDesignation: {
    width: "62%",
    paddingRight: 4,
  },
  colQty: {
    width: "10%",
    textAlign: "right",
    paddingRight: 4,
  },
  colUnit: {
    width: "10%",
    textAlign: "center",
    paddingRight: 4,
  },
  colPrice: {
    width: "18%",
    textAlign: "right",
  },
  totalsCard: {
    marginTop: 10,
    marginLeft: "auto",
    width: 220,
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    overflow: "hidden",
  },
  totalsMainRow: {
    backgroundColor: "#1e3a5f",
    color: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 10,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    fontWeight: 700,
  },
  totalsRow: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "1px solid #e2e8f0",
    color: "#334155",
  },
  footer: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 16,
    borderTop: "1px solid #cbd5e1",
    paddingTop: 6,
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
  },
  pageNumber: {
    position: "absolute",
    right: 24,
    bottom: 4,
    fontSize: 8,
    color: "#94a3b8",
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

function getParentKey(value: string | null) {
  return value ?? "root";
}

function buildRows(items: EstimateItemRow[]): FlattenedItem[] {
  const grouped = new Map<string, EstimateItemRow[]>();

  for (const item of items) {
    const key = getParentKey(item.parent_id);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  for (const list of grouped.values()) {
    list.sort((left, right) => left.position - right.position);
  }

  const rows: FlattenedItem[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = grouped.get(getParentKey(parentId)) ?? [];

    for (const item of list) {
      rows.push({ item, depth });
      if (item.item_type === "section") {
        walk(item.id, depth + 1);
      }
    }
  };

  walk(null, 0);
  return rows;
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
  };
}

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<VersionAccess> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, version_number, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

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
    throw mapSupabaseError(error, "Impossible de charger les lignes du chiffrage.");
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

async function loadLogoDataUri() {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-hydro-express.jpg");
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
  const storageClient = createOptionalServiceRoleClient() ?? input.supabase;
  const { data, error } = await storageClient.storage
    .from(ESTIMATE_DOCUMENTS_BUCKET)
    .createSignedUrl(input.filePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw internalError("Impossible de creer le lien de telechargement du PDF.", error);
  }

  return data.signedUrl;
}

async function upsertDocumentRow(input: {
  supabase: Supabase;
  payload: Database["public"]["Tables"]["estimate_documents"]["Insert"];
}) {
  const { error } = await input.supabase
    .from("estimate_documents")
    .upsert(input.payload, { onConflict: "tenant_id,version_id" });

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le statut du document PDF.");
  }
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

function toFilePath(input: { tenantId: string; estimateId: string; versionId: string }) {
  return `${input.tenantId}/${input.estimateId}/${input.versionId}.pdf`;
}

function buildPdfDocument(input: {
  logoDataUri: string | null;
  project: EmbeddedProject;
  version: VersionWithProject;
  rows: FlattenedItem[];
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
}) {
  const addressLabel = `${COMPANY_INFO.address.street}, ${COMPANY_INFO.address.postalCode} ${COMPANY_INFO.address.city}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {input.logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image style={styles.logo} src={input.logoDataUri} />
          ) : (
            <View />
          )}
          <View style={styles.companyBlock}>
            <Text>{COMPANY_INFO.name}</Text>
            <Text>{addressLabel}</Text>
            <Text>{COMPANY_INFO.phone.landline}</Text>
            <Text>SIRET {COMPANY_INFO.legal.siret}</Text>
          </View>
        </View>

        <Text style={styles.title}>Devis V{input.version.version_number}</Text>
        <Text style={styles.projectName}>{input.project.name}</Text>
        <Text style={styles.projectSub}>
          Client: {input.project.client_name ?? "-"}  |  Ref: {input.project.reference ?? "-"}
        </Text>

        <View style={styles.metaCard}>
          <View style={styles.metaColumn}>
            <View style={styles.metaRow}>
              <Text>Date devis</Text>
              <Text>{formatDate(input.version.date_devis)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text>Validite</Text>
              <Text>{input.version.validite_jours} jours</Text>
            </View>
          </View>
          <View style={styles.metaColumn}>
            <View style={styles.metaRow}>
              <Text>TVA</Text>
              <Text>{formatPercent(input.version.tax_rate_bp)} %</Text>
            </View>
          </View>
        </View>

        {input.version.exclusions?.trim() ? (
          <View style={styles.exclusionsCard}>
            <Text style={styles.exclusionsTitle}>Exclusions</Text>
            <Text style={styles.exclusionsText}>{input.version.exclusions.trim()}</Text>
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={styles.colDesignation}>Designation</Text>
            <Text style={styles.colQty}>Qte</Text>
            <Text style={styles.colUnit}>U</Text>
            <Text style={styles.colPrice}>Total HT</Text>
          </View>

          {input.rows.map(({ item, depth }) => {
            const isSection = item.item_type === "section";
            const title = (item.title ?? "").trim() || "Sans titre";
            const indentedTitle = `${"  ".repeat(depth)}${title}`;

            if (isSection) {
              return (
                <View key={item.id} style={[styles.row, styles.sectionRow]}>
                  <Text style={styles.colDesignation}>{indentedTitle}</Text>
                  <Text style={styles.colQty}>-</Text>
                  <Text style={styles.colUnit}>-</Text>
                  <Text style={styles.colPrice}>-</Text>
                </View>
              );
            }

            return (
              <View key={item.id} style={styles.row}>
                <Text style={styles.colDesignation}>{indentedTitle}</Text>
                <Text style={styles.colQty}>{formatQuantity(item.quantity)}</Text>
                <Text style={styles.colUnit}>{item.description?.trim() || "-"}</Text>
                <Text style={styles.colPrice}>{formatEUR(item.line_total_ht_cents ?? 0)}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totalsCard}>
          <View style={styles.totalsMainRow}>
            <Text>Total HT</Text>
            <Text>{formatEUR(input.totalHtCents)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>TVA</Text>
            <Text>{formatEUR(input.totalTaxCents)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>Total TTC</Text>
            <Text>{formatEUR(input.totalTtcCents)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Siege social: {addressLabel} - TVA {COMPANY_INFO.legal.vat}
          </Text>
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function markEstimatePdfProcessing(versionId: string): Promise<void> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);

  await upsertDocumentRow({
    supabase: context.supabase,
    payload: {
      tenant_id: context.tenantId,
      version_id: versionId,
      status: "processing",
      last_error: null,
      generated_by: context.userId,
      file_path: toFilePath({
        tenantId: context.tenantId,
        estimateId: access.project.id,
        versionId,
      }),
      sha256_hash: null,
      file_size_bytes: null,
      generated_at: null,
    },
  });
}

export async function markEstimatePdfFailed(
  versionId: string,
  message: string
): Promise<void> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, versionId);

  await upsertDocumentRow({
    supabase: context.supabase,
    payload: {
      tenant_id: context.tenantId,
      version_id: versionId,
      status: "failed",
      last_error: message.slice(0, 2000),
      generated_by: context.userId,
      file_path: toFilePath({
        tenantId: context.tenantId,
        estimateId: access.project.id,
        versionId,
      }),
    },
  });
}

export async function generateEstimatePdfNow(
  versionId: string,
  options: PdfGenerateOptions = {}
): Promise<PdfReadyPayload> {
  const context = await getAuthenticatedContext();
  const storageClient = createOptionalServiceRoleClient() ?? context.supabase;
  const access = await getVersionAccessOrThrow(context, versionId);

  const existing = await getDocumentRow({
    supabase: context.supabase,
    tenantId: context.tenantId,
    versionId,
  });
  const filePath = toFilePath({
    tenantId: context.tenantId,
    estimateId: access.project.id,
    versionId,
  });

  if (
    !options.force &&
    existing?.status === "ready" &&
    existing.file_path === filePath &&
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

  await upsertDocumentRow({
    supabase: context.supabase,
    payload: {
      tenant_id: context.tenantId,
      version_id: versionId,
      status: "processing",
      last_error: null,
      generated_by: context.userId,
      file_path: filePath,
      sha256_hash: null,
      file_size_bytes: null,
      generated_at: null,
    },
  });

  try {
    const items = await loadItems({
      supabase: context.supabase,
      tenantId: context.tenantId,
      versionId,
    });
    const rows = buildRows(items);
    const lineItems = items.filter((item) => item.item_type === "line");

    const laborRoleIds = Array.from(
      new Set(
        lineItems
          .flatMap((item) => [
            item.labor_role_id,
            item.labor_role_atelier_id,
            item.labor_role_chantier_id,
          ])
          .filter((value): value is string => Boolean(value))
      )
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

    const baseTotals = computeEstimateTotals({
      lineItems: lineItemsForTotals,
      marginMultiplier: access.version.margin_multiplier,
      marginMode: access.version.margin_mode,
      discountCents: 0,
      discountMode: access.version.discount_mode,
      discountStepsBp: access.version.discount_steps,
      globalCoefficient: access.version.global_coefficient,
      taxRateBp: access.version.tax_rate_bp,
      roundingMode: access.version.rounding_mode,
      roundingStepCents: access.version.rounding_step_cents,
    });
    const fallbackDiscountCents =
      baseTotals.saleSubtotalCents > 0
        ? Math.round((baseTotals.saleSubtotalCents * access.version.discount_bp) / 10000)
        : 0;

    const computedTotals = computeEstimateTotals({
      lineItems: lineItemsForTotals,
      marginMultiplier: access.version.margin_multiplier,
      marginMode: access.version.margin_mode,
      discountCents: fallbackDiscountCents,
      discountMode: access.version.discount_mode,
      discountStepsBp: access.version.discount_steps,
      globalCoefficient: access.version.global_coefficient,
      taxRateBp: access.version.tax_rate_bp,
      roundingMode: access.version.rounding_mode,
      roundingStepCents: access.version.rounding_step_cents,
    });

    const totalHtCents = access.version.total_ht_cents ?? computedTotals.saleTotalCents;
    const totalTaxCents =
      access.version.total_tax_cents ?? computedTotals.adjustedTaxCents;
    const totalTtcCents =
      access.version.total_ttc_cents ?? computedTotals.roundedTtcCents;

    const logoDataUri = await loadLogoDataUri();
    const pdfDocument = buildPdfDocument({
      logoDataUri,
      project: access.project,
      version: access.version,
      rows,
      totalHtCents,
      totalTaxCents,
      totalTtcCents,
    });

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderToBuffer(pdfDocument);
    } catch (error) {
      throw internalError("Impossible de generer le binaire PDF.", error);
    }

    const { error: uploadError } = await storageClient.storage
      .from(ESTIMATE_DOCUMENTS_BUCKET)
      .upload(filePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw internalError("Impossible de televerser le PDF dans le storage.", uploadError);
    }

    const sha256Hash = createHash("sha256").update(pdfBuffer).digest("hex").toLowerCase();
    const generatedAt = new Date().toISOString();

    await upsertDocumentRow({
      supabase: context.supabase,
      payload: {
        tenant_id: context.tenantId,
        version_id: versionId,
        status: "ready",
        last_error: null,
        file_path: filePath,
        sha256_hash: sha256Hash,
        file_size_bytes: pdfBuffer.byteLength,
        generated_by: context.userId,
        generated_at: generatedAt,
      },
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

      await upsertDocumentRow({
        supabase: context.supabase,
        payload: {
          tenant_id: context.tenantId,
          version_id: versionId,
          status: "failed",
          last_error: message.slice(0, 2000),
          file_path: filePath,
          generated_by: context.userId,
          sha256_hash: null,
          file_size_bytes: null,
          generated_at: null,
        },
      });
    } catch {
      // Best effort status update when generation fails.
    }

    throw error;
  }
}

export async function getEstimatePdfStatus(versionId: string): Promise<PdfStatusPayload> {
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

  if (!row.file_path) {
    return {
      status: "failed",
      last_error: "Chemin du document PDF manquant.",
    };
  }

  const expectedFilePath = toFilePath({
    tenantId: context.tenantId,
    estimateId: access.project.id,
    versionId,
  });
  if (row.file_path !== expectedFilePath) {
    return {
      status: "failed",
      last_error: "Chemin du document PDF non conforme.",
    };
  }

  const downloadUrl = await createSignedUrlOrThrow({
    supabase: context.supabase,
    filePath: expectedFilePath,
  });

  return {
    status: "ready",
    download_url: downloadUrl,
    file_path: expectedFilePath,
    sha256_hash: row.sha256_hash ?? undefined,
    generated_at: row.generated_at ?? undefined,
    file_size_bytes: row.file_size_bytes === null ? undefined : Number(row.file_size_bytes),
  };
}

function formatChangelogDelta(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatEUR(cents)}`;
}

function formatChangelogFieldValue(
  field: EstimateVersionChangelogField,
  value: string | number | null
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
  changeType: EstimateVersionChangelogChange["changeType"]
) {
  if (changeType === "added") return "Ajout";
  if (changeType === "removed") return "Suppression";
  return "Modification";
}

function changelogEntityLabel(
  entityType: EstimateVersionChangelogChange["entityType"]
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
                      HT {formatChangelogDelta(change.deltaHtCents)}{"\n"}
                      TTC {formatChangelogDelta(change.deltaTtcCents)}
                    </Text>
                  </View>

                  {change.fields.length > 0 ? (
                    <View style={changelogStyles.fieldTable}>
                      <View style={[changelogStyles.fieldRow, changelogStyles.fieldHeadRow]}>
                        <View style={changelogStyles.fieldColLabel}>
                          <Text style={changelogStyles.fieldHeadText}>Champ</Text>
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
                            <Text style={changelogStyles.fieldBodyText}>{field.label}</Text>
                          </View>
                          <View style={changelogStyles.fieldColBefore}>
                            <Text style={changelogStyles.fieldBodyText}>
                              {formatChangelogFieldValue(field, field.beforeValue)}
                            </Text>
                          </View>
                          <View style={changelogStyles.fieldColAfter}>
                            <Text style={changelogStyles.fieldBodyText}>
                              {formatChangelogFieldValue(field, field.afterValue)}
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
