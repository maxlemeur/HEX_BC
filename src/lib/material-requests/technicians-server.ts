import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { conflict, forbidden, mapSupabaseError, notFound, type SupabaseErrorLike } from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";

import type {
  MaterialRequest,
  MaterialRequestLine,
  MaterialRequestSummary,
  MaterialRequestTechnician,
} from "./contracts";
import {
  LINE_COLUMNS,
  REQUEST_COLUMNS,
  TECHNICIAN_COLUMNS,
  assertProjectInTenant,
  canReadProject,
  canWriteTechnicians,
  listTenantTechnicians,
  readTechnician,
  summarizeRequests,
  type MaterialRequestContext,
} from "./server-shared";

/**
 * The technicians of a tenant (TI-690): a plain list of names, since technicians have no account.
 * Every member reads it; an admin or an engineer adds and changes names. Nobody deletes one: a
 * technician who left is deactivated and their past requests keep their name.
 */

export const MATERIAL_REQUEST_TECHNICIAN_EXISTS = "MATERIAL_REQUEST_TECHNICIAN_EXISTS";
export const TECHNICIAN_HISTORY_DEFAULT_LIMIT = 10;
export const TECHNICIAN_HISTORY_MAX_LIMIT = 20;

const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_PAGES = 20;

function requireTechnicianWriter(context: MaterialRequestContext) {
  if (!canWriteTechnicians(context)) throw forbidden("Vous ne pouvez pas modifier la liste des techniciens.");
}

/** The database keeps one name per tenant, whatever its case and spacing. */
function mapTechnicianError(error: SupabaseErrorLike) {
  if (error.code === "23505") return conflict("Ce technicien existe déjà.", undefined, MATERIAL_REQUEST_TECHNICIAN_EXISTS);
  return mapSupabaseError(error, "Impossible d'enregistrer le technicien.");
}

export async function listMaterialRequestTechnicians(): Promise<{ items: MaterialRequestTechnician[] }> {
  const context = await getAuthenticatedTenantContext();
  return { items: await listTenantTechnicians(context) };
}

export async function createMaterialRequestTechnician(input: {
  name: string;
  current_project_id?: string | null;
}): Promise<{ item: MaterialRequestTechnician }> {
  const context = await getAuthenticatedTenantContext();
  requireTechnicianWriter(context);
  await assertProjectInTenant(context, input.current_project_id);

  const { data, error } = await context.supabase
    .from("material_request_technicians")
    .insert({
      name: input.name,
      ...(input.current_project_id === undefined ? {} : { current_project_id: input.current_project_id }),
      created_by: context.userId,
    })
    .select(TECHNICIAN_COLUMNS)
    .single();
  if (error) throw mapTechnicianError(error);
  return { item: data };
}

export async function updateMaterialRequestTechnician(
  technicianId: string,
  input: { name?: string; current_project_id?: string | null; is_active?: boolean },
): Promise<{ item: MaterialRequestTechnician }> {
  const context = await getAuthenticatedTenantContext();
  requireTechnicianWriter(context);
  if (!(await readTechnician(context, technicianId))) throw notFound("Technicien introuvable.");
  await assertProjectInTenant(context, input.current_project_id);

  const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as typeof input;
  const { data, error } = await context.supabase
    .from("material_request_technicians")
    .update(patch)
    .eq("id", technicianId)
    .eq("tenant_id", context.tenantId)
    .select(TECHNICIAN_COLUMNS)
    .maybeSingle();
  if (error) throw mapTechnicianError(error);
  if (!data) throw notFound("Technicien introuvable.");
  return { item: data };
}

/**
 * A technician's most recent requests, across the affaires the caller can read: what they usually ask
 * for helps to read what they ask now. The affaire of each request is checked here as it is by RLS
 * (owner, admin or director; an archived affaire is closed to this screen).
 */
async function readReadableRequests(context: MaterialRequestContext, technicianId: string, limit: number) {
  const kept: Array<{ request: MaterialRequest; projectName: string }> = [];
  for (let page = 0; page < HISTORY_MAX_PAGES && kept.length < limit; page += 1) {
    const { data: requests, error } = await context.supabase
      .from("material_requests")
      .select(REQUEST_COLUMNS)
      .eq("tenant_id", context.tenantId)
      .eq("technician_id", technicianId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE - 1);
    if (error) throw mapSupabaseError(error, "Impossible de charger les demandes du technicien.");
    if (!requests || requests.length === 0) break;

    const { data: projects, error: projectsError } = await context.supabase
      .from("estimate_projects")
      .select("id, name, user_id, is_archived")
      .eq("tenant_id", context.tenantId)
      .in("id", [...new Set(requests.map((request) => request.project_id))]);
    if (projectsError) throw mapSupabaseError(projectsError, "Impossible de charger les affaires du technicien.");
    const readable = new Map(
      (projects ?? [])
        .filter((project) => !project.is_archived && canReadProject(context, project))
        .map((project) => [project.id, project.name]),
    );
    for (const request of requests) {
      const projectName = readable.get(request.project_id);
      if (projectName !== undefined && kept.length < limit) kept.push({ request, projectName });
    }
    if (requests.length < HISTORY_PAGE_SIZE) break;
  }
  return kept;
}

export async function listTechnicianRequests(technicianId: string, limit: number): Promise<{
  items: Array<{ request: MaterialRequestSummary & { project_name: string }; lines: MaterialRequestLine[] }>;
}> {
  const context = await getAuthenticatedTenantContext();
  const technician = await readTechnician(context, technicianId);
  if (!technician) throw notFound("Technicien introuvable.");

  const kept = await readReadableRequests(context, technician.id, limit);
  if (kept.length === 0) return { items: [] };
  const ids = kept.map((entry) => entry.request.id);
  const [lines, files] = await Promise.all([
    readAllRows(() => context.supabase.from("material_request_lines").select(LINE_COLUMNS, { count: "exact" })
      .eq("tenant_id", context.tenantId).in("request_id", ids)),
    readAllRows(() => context.supabase.from("material_request_files").select("id, request_id", { count: "exact" })
      .eq("tenant_id", context.tenantId).in("request_id", ids).not("stored_at", "is", null).is("removed_at", null)),
  ]);
  if (lines.error) throw mapSupabaseError(lines.error, "Impossible de charger les lignes des demandes.");
  if (files.error) throw mapSupabaseError(files.error, "Impossible de charger les originaux des demandes.");

  const summaries = summarizeRequests(kept.map((entry) => entry.request), {
    lines: lines.data ?? [],
    files: files.data ?? [],
    technicians: [technician],
  });
  return {
    items: summaries.map((summary, index) => ({
      request: { ...summary, project_name: kept[index].projectName },
      lines: (lines.data ?? [])
        .filter((line) => line.request_id === summary.id)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)),
    })),
  };
}
