import { type AuthenticatedTenantContext, getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  type ApiError,
  type SupabaseErrorLike,
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";

import type {
  MaterialRequest,
  MaterialRequestFile,
  MaterialRequestLine,
  MaterialRequestSummary,
  MaterialRequestTechnician,
} from "./contracts";
import { MATERIAL_REQUEST_LINE_PRICED } from "./quote-contracts";

/**
 * What every material request route starts with (TI-690): who is asking, in which tenant, on which
 * affaire, and what they may do there. RLS says the same in the database; it is repeated here so that a
 * refusal has a status and a sentence, and so that every query names the tenant and the affaire of the
 * URL. Reading follows the affaire (owner, admin, director); writing asks for its owner or an admin,
 * with the role admin or engineer.
 */

/** The columns each record type exposes: exactly the contract, nothing internal (tenant, path, authors). */
export const REQUEST_COLUMNS =
  "id, project_id, technician_id, requested_on, needed_on, delivery_place, is_urgent, presumed_material, material_confirmed, presumed_supplier_id, supplier_confirmed, source_text, note, created_at, updated_at";
export const LINE_COLUMNS =
  "id, request_id, position, original_text, quantity, quantity_doubtful, unit, dimension, no_dimension, product_type, material, material_precision, reference, supplier_id, zone, imputation, overhead_category, duplicate_acknowledged, status, validated_at, product_id, product_match, unit_price_ht_cents, price_per, price_quote_id";
export const FILE_COLUMNS = "id, request_id, quote_id, file_name, mime_type, byte_size, rotation, created_at";
export const TECHNICIAN_COLUMNS = "id, name, current_project_id, is_active";

/** What makes two lines the same piece (alerts.ts): once one of these changes, a kept duplicate is asked again. */
export const DUPLICATE_KEYS = ["product_type", "dimension", "material", "zone", "imputation"] as const satisfies ReadonlyArray<keyof MaterialRequestLine>;

export type MaterialRequestContext = AuthenticatedTenantContext;

export type MaterialRequestProject = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  is_archived: boolean;
};

export type MaterialRequestAccess = {
  context: MaterialRequestContext;
  project: MaterialRequestProject;
  canWrite: boolean;
};

export function canWriteTechnicians(context: MaterialRequestContext): boolean {
  return context.tenantRole === "admin" || context.tenantRole === "engineer";
}

export function canReadProject(context: MaterialRequestContext, project: Pick<MaterialRequestProject, "user_id">): boolean {
  return project.user_id === context.userId || context.tenantRole === "admin" || context.tenantRole === "director";
}

function canWriteProject(context: MaterialRequestContext, project: Pick<MaterialRequestProject, "user_id">): boolean {
  return (project.user_id === context.userId || context.tenantRole === "admin") && canWriteTechnicians(context);
}

/** 404 for an affaire of another tenant or an archived one; 403 for an affaire the member may not open. */
export async function requireProjectAccess(projectId: string, mode: "read" | "write"): Promise<MaterialRequestAccess> {
  const context = await getAuthenticatedTenantContext();
  const { data, error } = await context.supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, name, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger l'affaire.");
  if (!data || data.is_archived) throw notFound("Affaire introuvable.");
  if (!canReadProject(context, data)) throw forbidden("Accès refusé à cette affaire.");
  const canWrite = canWriteProject(context, data);
  if (mode === "write" && !canWrite) {
    throw forbidden("Vous ne pouvez pas modifier les demandes de matériel de cette affaire.");
  }
  return { context, project: data, canWrite };
}

/** A request of the affaire of the URL, or 404: an id from another affaire is not found here. */
export async function requireRequest(access: MaterialRequestAccess, requestId: string): Promise<MaterialRequest> {
  const { data, error } = await access.context.supabase
    .from("material_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", requestId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger la demande de matériel.");
  if (!data) throw notFound("Demande de matériel introuvable.");
  return data;
}

export async function readRequestLines(access: MaterialRequestAccess, requestId: string): Promise<MaterialRequestLine[]> {
  const { data, error } = await access.context.supabase
    .from("material_request_lines")
    .select(LINE_COLUMNS)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw mapSupabaseError(error, "Impossible de charger les lignes de la demande.");
  return data ?? [];
}

/**
 * The originals of a request that exist for a reader: those whose bytes are stored and whose deletion
 * has not begun. A row is recorded before its bytes (the storage policy needs it), marked `stored_at`
 * after them, and marked `removed_at` before they go; outside that span it is neither listed, counted
 * nor served. The files of a quote (TI-691) are listed with their quote, not here.
 */
export async function readRequestFiles(access: MaterialRequestAccess, requestId: string): Promise<MaterialRequestFile[]> {
  const { data, error } = await access.context.supabase
    .from("material_request_files")
    .select(FILE_COLUMNS)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .is("quote_id", null)
    .not("stored_at", "is", null)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw mapSupabaseError(error, "Impossible de charger les originaux de la demande.");
  return data ?? [];
}

export async function readTechnician(context: MaterialRequestContext, technicianId: string): Promise<MaterialRequestTechnician | null> {
  const { data, error } = await context.supabase
    .from("material_request_technicians")
    .select(TECHNICIAN_COLUMNS)
    .eq("id", technicianId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger le technicien.");
  return data;
}

export async function listTenantTechnicians(context: MaterialRequestContext): Promise<MaterialRequestTechnician[]> {
  const { data, error } = await readAllRows(() => context.supabase
    .from("material_request_technicians")
    .select(TECHNICIAN_COLUMNS, { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .order("name", { ascending: true }));
  if (error) throw mapSupabaseError(error, "Impossible de charger les techniciens.");
  return data ?? [];
}

/** A technician named by the client belongs to the active tenant, or the request is refused. */
export async function assertTechnicianInTenant(context: MaterialRequestContext, technicianId: string | null | undefined) {
  if (!technicianId) return;
  if (!(await readTechnician(context, technicianId))) throw badRequest("Technicien introuvable.");
}

export async function assertSuppliersInTenant(context: MaterialRequestContext, supplierIds: ReadonlyArray<string | null | undefined>) {
  const ids = [...new Set(supplierIds.filter((id): id is string => typeof id === "string"))];
  if (ids.length === 0) return;
  const { data, error } = await context.supabase
    .from("suppliers")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .in("id", ids);
  if (error) throw mapSupabaseError(error, "Impossible de vérifier le fournisseur.");
  if ((data ?? []).length !== ids.length) throw badRequest("Fournisseur introuvable.");
}

export async function assertProjectInTenant(context: MaterialRequestContext, projectId: string | null | undefined) {
  if (!projectId) return;
  const { data, error } = await context.supabase
    .from("estimate_projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de vérifier l'affaire.");
  if (!data) throw badRequest("Affaire introuvable.");
}

/** Line numbers as a sentence reads them: « 3 », « 2 et 3 », « 1, 2 et 4 ». */
export function linePositionsLabel(positions: readonly number[]): string {
  const sorted = [...positions].sort((left, right) => left - right).map(String);
  return sorted.length <= 1 ? sorted.join("") : `${sorted.slice(0, -1).join(", ")} et ${sorted[sorted.length - 1]}`;
}

/**
 * TI-691: what a line priced by a retained quote orders, at the quote's price: it no longer changes (no way back in
 * this delivery). The line trigger refuses the same (MATERIAL_REQUEST_LINE_PRICED); its zone, imputation, the
 * technician's words, the quantity doubt and the duplicate acknowledgement stay editable.
 */
export const PRICED_LINE_ORDER = [
  "product_id", "product_match", "product_type", "dimension", "no_dimension", "material", "material_precision", "reference",
  "unit", "quantity",
] as const satisfies ReadonlyArray<keyof MaterialRequestLine>;

export type PricedLineRefusal = "supplier" | "ordered" | "delete";

type LineRef = Pick<MaterialRequestLine, "id" | "position">;

/** 409 for lines a retained quote priced: their supplier, what they order, or their deletion alone. */
export function pricedLinesRefusal(lines: readonly LineRef[], what: PricedLineRefusal): ApiError {
  const sorted = [...lines].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const positions = sorted.map((line) => line.position);
  const one = positions.length === 1;
  const subject = one ? `La ligne ${linePositionsLabel(positions)} a` : `Les lignes ${linePositionsLabel(positions)} ont`;
  const consequence = {
    supplier: one ? "son fournisseur est celui du devis" : "leur fournisseur est celui du devis",
    ordered: `ce qu’${one ? "elle commande" : "elles commandent"} (article, désignation, dimension, matière, référence, unité, quantité) ne change plus`,
    delete: one ? "elle ne se supprime plus seule" : "elles ne se suppriment plus seules",
  }[what];
  return conflict(`${subject} un devis retenu : ${consequence}.`, { line_ids: sorted.map((line) => line.id), positions },
    MATERIAL_REQUEST_LINE_PRICED);
}

/**
 * The priced lines a change would touch where it may not, and how: their supplier first, then what they order. Null
 * when the change leaves every priced line's supplier and order as they are (sending the same value is no change).
 */
export function pricedLineChanges(
  lines: readonly MaterialRequestLine[],
  patch: Partial<Record<string, unknown>>,
): { lines: MaterialRequestLine[]; what: PricedLineRefusal } | null {
  const priced = lines.filter((line) => line.price_quote_id !== null);
  const differs = (line: MaterialRequestLine, key: keyof MaterialRequestLine) => key in patch && patch[key] !== line[key];
  const supplier = priced.filter((line) => differs(line, "supplier_id"));
  if (supplier.length > 0) return { lines: supplier, what: "supplier" };
  const ordered = priced.filter((line) => PRICED_LINE_ORDER.some((key) => differs(line, key)));
  return ordered.length > 0 ? { lines: ordered, what: "ordered" } : null;
}

/** The database's own refusals of the same, when another session retained a quote since the lines were read. */
export function pricedLineDatabaseRefusal(lines: readonly LineRef[]) {
  return (error: SupabaseErrorLike): ApiError | null => {
    if (error.message === "MATERIAL_REQUEST_LINE_SUPPLIER_FROM_QUOTE") return pricedLinesRefusal(lines, "supplier");
    if (error.message === "MATERIAL_REQUEST_LINE_PRICED") return pricedLinesRefusal(lines, "ordered");
    return null;
  };
}

/** Counts and technician names of a set of requests, from rows the caller has read whole. */
export function summarizeRequests(
  requests: readonly MaterialRequest[],
  rows: {
    lines: ReadonlyArray<Pick<MaterialRequestLine, "request_id" | "status">>;
    files: ReadonlyArray<Pick<MaterialRequestFile, "request_id">>;
    technicians: readonly MaterialRequestTechnician[];
  },
): MaterialRequestSummary[] {
  const counts = new Map<string, { lines: number; validated: number; files: number }>();
  const countsOf = (requestId: string) => {
    let entry = counts.get(requestId);
    if (!entry) counts.set(requestId, (entry = { lines: 0, validated: 0, files: 0 }));
    return entry;
  };
  for (const line of rows.lines) {
    const entry = countsOf(line.request_id);
    entry.lines += 1;
    if (line.status === "validated") entry.validated += 1;
  }
  for (const file of rows.files) countsOf(file.request_id).files += 1;
  const technicianNames = new Map(rows.technicians.map((technician) => [technician.id, technician.name]));

  return requests.map((request) => ({
    ...request,
    technician_name: request.technician_id ? (technicianNames.get(request.technician_id) ?? null) : null,
    line_count: counts.get(request.id)?.lines ?? 0,
    validated_line_count: counts.get(request.id)?.validated ?? 0,
    file_count: counts.get(request.id)?.files ?? 0,
  }));
}
