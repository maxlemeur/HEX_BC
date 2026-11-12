import {
  type ApiError,
  type SupabaseErrorLike,
  badRequest,
  conflict,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";

import { blockingAlertCodes, type AlertContext, type MaterialRequestLineAlertCode } from "./alerts";
import {
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_PRESUMPTION_CHANGED,
  type BulkUpdateMaterialRequestLinesData,
  type CreateMaterialRequestData,
  type MaterialRequest,
  type MaterialRequestDetail,
  type MaterialRequestLine,
  type MaterialRequestLineData,
  type MaterialRequestSummary,
  type MaterialRequestTechnician,
  type MaterialRequestUpdateResult,
  type UpdateMaterialRequestData,
} from "./contracts";
import { removeRequestOriginals } from "./files-server";
import { readArticleSummaries } from "./articles-server";
import {
  DUPLICATE_KEYS,
  LINE_COLUMNS,
  REQUEST_COLUMNS,
  assertSuppliersInTenant,
  assertTechnicianInTenant,
  listTenantTechnicians,
  pricedLineChanges,
  pricedLineDatabaseRefusal,
  pricedLinesRefusal,
  readRequestFiles,
  readRequestLines,
  readTechnician,
  requireProjectAccess,
  requireRequest,
  summarizeRequests,
  type MaterialRequestAccess,
} from "./server-shared";

/**
 * Requests and their lines (TI-690): the office rewrites what a technician asked for. Rights are
 * checked here, never in the routes, and every query names the active tenant and the affaire of the
 * URL. Originals are in files-server.ts, the list of technicians in technicians-server.ts.
 */

export const MATERIAL_REQUEST_LINES_BLOCKED = "MATERIAL_REQUEST_LINES_BLOCKED";
export const MATERIAL_REQUEST_LINE_LIMIT = "MATERIAL_REQUEST_LINE_LIMIT";

export type MaterialRequestSupplierOption = { id: string; name: string };

/** The keys a client actually sent: an omitted key leaves its column alone. */
function sent<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function byPosition(left: MaterialRequestLine, right: MaterialRequestLine): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function mostRecentFirst(left: MaterialRequest, right: MaterialRequest): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at) || left.id.localeCompare(right.id);
}

export async function listMaterialRequests(projectId: string): Promise<{
  items: MaterialRequestSummary[];
  technicians: MaterialRequestTechnician[];
  canWrite: boolean;
}> {
  const access = await requireProjectAccess(projectId, "read");
  const { supabase, tenantId } = access.context;
  // Read whole, page by page: a count cut at the API's row ceiling would be a wrong count.
  const [requests, lines, files, technicians] = await Promise.all([
    readAllRows(() => supabase.from("material_requests").select(REQUEST_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId).eq("project_id", access.project.id)),
    readAllRows(() => supabase.from("material_request_lines").select("id, request_id, status", { count: "exact" })
      .eq("tenant_id", tenantId).eq("project_id", access.project.id)),
    readAllRows(() => supabase.from("material_request_files").select("id, request_id", { count: "exact" })
      .eq("tenant_id", tenantId).eq("project_id", access.project.id).is("quote_id", null)
      .not("stored_at", "is", null).is("removed_at", null)),
    listTenantTechnicians(access.context),
  ]);
  if (requests.error) throw mapSupabaseError(requests.error, "Impossible de charger les demandes de matériel.");
  if (lines.error) throw mapSupabaseError(lines.error, "Impossible de charger les lignes des demandes.");
  if (files.error) throw mapSupabaseError(files.error, "Impossible de charger les originaux des demandes.");

  return {
    items: summarizeRequests([...(requests.data ?? [])].sort(mostRecentFirst), {
      lines: lines.data ?? [],
      files: files.data ?? [],
      technicians,
    }),
    technicians,
    canWrite: access.canWrite,
  };
}

/** A confirmation is about a value: without one there is nothing to confirm. */
function assertConfirmable(
  input: Pick<UpdateMaterialRequestData, "material_confirmed" | "supplier_confirmed">,
  next: { material: string | null; supplierId: string | null },
) {
  if (input.material_confirmed === true && next.material === null) {
    throw badRequest("Aucune matière présumée à confirmer.");
  }
  if (input.supplier_confirmed === true && next.supplierId === null) {
    throw badRequest("Aucun fournisseur présumé à confirmer.");
  }
}

export async function createMaterialRequest(
  projectId: string,
  input: CreateMaterialRequestData,
): Promise<MaterialRequestDetail> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  assertConfirmable(input, { material: input.presumed_material ?? null, supplierId: input.presumed_supplier_id ?? null });
  await Promise.all([
    assertTechnicianInTenant(context, input.technician_id),
    assertSuppliersInTenant(context, [input.presumed_supplier_id]),
  ]);

  const { data, error } = await context.supabase
    .from("material_requests")
    .insert({ ...sent(input), project_id: access.project.id, created_by: context.userId })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw mapSupabaseError(error, "Impossible d'enregistrer la demande de matériel.");

  return {
    request: data,
    technician: data.technician_id ? await readTechnician(context, data.technician_id) : null,
    files: [],
    lines: [],
    articles: {},
  };
}

async function readMaterialOptions(access: MaterialRequestAccess): Promise<string[]> {
  const { data, error } = await access.context.supabase.rpc("material_request_material_options");
  if (error) throw mapSupabaseError(error, "Impossible de charger les matières connues.");
  const unique = [...new Set((data ?? []).map((material) => material.trim()).filter((material) => material.length > 0))];
  return unique.sort((left, right) => left.localeCompare(right, "fr"));
}

async function readSupplierOptions(access: MaterialRequestAccess): Promise<MaterialRequestSupplierOption[]> {
  const { context } = access;
  const { data, error } = await readAllRows(() => context.supabase
    .from("suppliers")
    .select("id, name", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true));
  if (error) throw mapSupabaseError(error, "Impossible de charger les fournisseurs.");
  return (data ?? [])
    .map((supplier) => ({ id: supplier.id, name: supplier.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr") || left.id.localeCompare(right.id));
}

export async function getMaterialRequestDetail(projectId: string, requestId: string): Promise<
  MaterialRequestDetail & { canWrite: boolean; materialOptions: string[]; supplierOptions: MaterialRequestSupplierOption[] }
> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  const [technician, files, lines, materialOptions, supplierOptions] = await Promise.all([
    request.technician_id ? readTechnician(access.context, request.technician_id) : null,
    readRequestFiles(access, request.id),
    readRequestLines(access, request.id),
    readMaterialOptions(access),
    readSupplierOptions(access),
  ]);
  const articles = await readArticleSummaries(access.context, lines.map((line) => line.product_id));
  return { request, technician, files, lines, articles, canWrite: access.canWrite, materialOptions, supplierOptions };
}

type RequestPatch = Partial<Omit<UpdateMaterialRequestData, "expected_presumed_material" | "expected_presumed_supplier_id">>;
/** The presumed values a write is conditional on: it reaches the request only while they are the ones stored. */
type Presumption = { material?: string; supplierId?: string };

/**
 * One statement. With a presumption, the condition is part of it: the request is written only if it
 * still presumes exactly that, whatever another session did since it was read. Null when it does not.
 */
async function writeRequest(
  access: MaterialRequestAccess,
  requestId: string,
  patch: RequestPatch,
  presumption: Presumption = {},
): Promise<MaterialRequest | null> {
  let statement = access.context.supabase
    .from("material_requests")
    .update(patch)
    .eq("id", requestId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id);
  if (presumption.material !== undefined) statement = statement.eq("presumed_material", presumption.material);
  if (presumption.supplierId !== undefined) statement = statement.eq("presumed_supplier_id", presumption.supplierId);
  const { data, error } = await statement.select(REQUEST_COLUMNS).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible d'enregistrer la demande de matériel.");
  return data;
}

/** Why a conditional write reached nothing: the request is gone (404), or it presumes something else (409). */
async function presumptionChanged(access: MaterialRequestAccess, requestId: string, presumption: Presumption): Promise<ApiError> {
  const stored = await requireRequest(access, requestId);
  // An unconditional write that reached nothing: the request can no longer be written by this caller.
  if (presumption.material === undefined && presumption.supplierId === undefined) {
    return notFound("Demande de matériel introuvable.");
  }
  const material = presumption.material !== undefined && stored.presumed_material !== presumption.material;
  return conflict(
    material
      ? "La matière présumée a été modifiée entre-temps : rechargez la demande, puis confirmez la matière affichée."
      : "Le fournisseur présumé a été modifié entre-temps : rechargez la demande, puis confirmez le fournisseur affiché.",
    { field: material ? "presumed_material" : "presumed_supplier_id" },
    MATERIAL_REQUEST_PRESUMPTION_CHANGED,
  );
}

/** A line that is validated in the request's presumed material: no material of its own, not overhead. */
function reliesOnPresumedMaterial(line: Pick<MaterialRequestLine, "material" | "imputation">): boolean {
  return line.imputation === "project" && !(line.material ?? "").trim();
}

export async function updateMaterialRequest(
  projectId: string,
  requestId: string,
  input: UpdateMaterialRequestData,
): Promise<MaterialRequestUpdateResult> {
  const access = await requireProjectAccess(projectId, "write");
  const current = await requireRequest(access, requestId);
  const next = {
    material: input.presumed_material === undefined ? current.presumed_material : input.presumed_material,
    supplierId: input.presumed_supplier_id === undefined ? current.presumed_supplier_id : input.presumed_supplier_id,
  };
  assertConfirmable(input, next);
  await Promise.all([
    assertTechnicianInTenant(access.context, input.technician_id),
    assertSuppliersInTenant(access.context, [input.presumed_supplier_id]),
  ]);

  // A confirmation never outlives the value it was given for (the database withdraws it too), and it
  // is bound to the value its author saw:
  //  - given with a new value, it is recorded after that value, in a second statement that only
  //    reaches the request while it still presumes exactly what this request has just written;
  //  - given alone with `expected_...`, the write is conditional on that value being the one stored;
  //  - given alone without it, it confirms what is stored (what the caller last read).
  const { expected_presumed_material: expectedMaterial, expected_presumed_supplier_id: expectedSupplierId, ...fields } = input;
  const patch: RequestPatch = sent(fields);
  const confirmAfter: RequestPatch = {};
  const confirmedFor: Presumption = {};
  const materialChanges = next.material !== current.presumed_material;
  if (materialChanges) {
    patch.material_confirmed = false;
    if (input.material_confirmed === true && next.material !== null) {
      confirmAfter.material_confirmed = true;
      confirmedFor.material = next.material;
    }
  }
  if (next.supplierId !== current.presumed_supplier_id) {
    patch.supplier_confirmed = false;
    if (input.supplier_confirmed === true && next.supplierId !== null) {
      confirmAfter.supplier_confirmed = true;
      confirmedFor.supplierId = next.supplierId;
    }
  }

  // The database returns to draft, in the statement that withdraws a presumed material, the validated
  // lines that relied on it. They are read before and after, so that the answer names what really
  // happened to them rather than what this code expects.
  const withdrawsMaterial = materialChanges || (current.material_confirmed && input.material_confirmed === false);
  const relying = withdrawsMaterial
    ? (await readRequestLines(access, current.id)).filter((line) => line.status === "validated" && reliesOnPresumedMaterial(line))
    : [];

  const expected: Presumption = { material: expectedMaterial, supplierId: expectedSupplierId };
  let request = await writeRequest(access, current.id, patch, expected);
  if (!request) throw await presumptionChanged(access, current.id, expected);
  if (Object.keys(confirmAfter).length > 0) {
    request = await writeRequest(access, current.id, confirmAfter, confirmedFor);
    // Another session changed the value in between: nothing more is written, and nothing is confirmed.
    if (!request) throw await presumptionChanged(access, current.id, confirmedFor);
  }
  if (relying.length === 0) return { request, reopened_line_ids: [] };

  const wasValidated = new Set(relying.map((line) => line.id));
  const reopened = (await readRequestLines(access, current.id))
    .filter((line) => wasValidated.has(line.id) && line.status === "draft")
    .map((line) => line.id);
  return { request, reopened_line_ids: reopened };
}

export async function deleteMaterialRequest(projectId: string, requestId: string): Promise<{ deleted: true }> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const request = await requireRequest(access, requestId);

  // Its originals first, stored or not (an interrupted upload may have left bytes): withdrawn, then
  // without their bytes, while their rows still authorise it. The rows go with the request.
  await removeRequestOriginals(access, request.id);

  const { data, error } = await context.supabase
    .from("material_requests")
    .delete()
    .eq("id", request.id)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", access.project.id)
    .select("id")
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de supprimer la demande de matériel.");
  if (!data) throw notFound("Demande de matériel introuvable.");
  return { deleted: true };
}

async function countLines(access: MaterialRequestAccess, requestId: string): Promise<number> {
  const { count, error } = await access.context.supabase
    .from("material_request_lines")
    .select("id", { count: "exact" })
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .limit(1);
  if (error) throw mapSupabaseError(error, "Impossible de charger les lignes de la demande.");
  return count ?? 0;
}

function lineLimitReached(existing: number): ApiError {
  return unprocessableEntity(
    `Une demande compte ${MATERIAL_REQUEST_MAX_LINES} lignes au plus (${existing} déjà saisies).`,
    { max: MATERIAL_REQUEST_MAX_LINES, existing },
    MATERIAL_REQUEST_LINE_LIMIT,
  );
}

export async function createMaterialRequestLines(
  projectId: string,
  requestId: string,
  lines: readonly MaterialRequestLineData[],
): Promise<{ lines: MaterialRequestLine[] }> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const request = await requireRequest(access, requestId);

  // The friendly, early refusal. The cap itself is held by the database, which counts under a lock on
  // the request: two appends that both saw room here cannot both pass there.
  const count = await countLines(access, request.id);
  if (count + lines.length > MATERIAL_REQUEST_MAX_LINES) throw lineLimitReached(count);
  await assertSuppliersInTenant(context, lines.map((line) => line.supplier_id));

  // New lines are drafts, appended after the last one in the order given. Positions are unique in a
  // request: when another append took them first (a double click), read the end again and retry.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: tail, error: tailError } = await context.supabase
      .from("material_request_lines")
      .select("id, position")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", request.id)
      .order("position", { ascending: false })
      .limit(1);
    if (tailError) throw mapSupabaseError(tailError, "Impossible de charger les lignes de la demande.");
    const last = tail?.[0]?.position ?? 0;
    const { data, error } = await context.supabase
      .from("material_request_lines")
      .insert(lines.map((line, index) => ({
        ...sent(line),
        project_id: access.project.id,
        request_id: request.id,
        position: last + 1 + index,
      })))
      .select(LINE_COLUMNS);
    if (!error) return { lines: [...(data ?? [])].sort(byPosition) };
    // The database refused the whole batch for the cap: another session appended since the count above.
    if (error.message === MATERIAL_REQUEST_LINE_LIMIT) throw lineLimitReached(await countLines(access, request.id));
    if (error.code !== "23505") throw mapSupabaseError(error, "Impossible d'ajouter les lignes.");
  }
  throw conflict("Des lignes viennent d’être ajoutées à cette demande. Rechargez-la, puis réessayez.");
}

/** The requested lines, all of this request, or 404: an id from another request is not found here. */
function selectLines(lines: readonly MaterialRequestLine[], ids: readonly string[]): MaterialRequestLine[] {
  const wanted = new Set(ids);
  const selected = lines.filter((line) => wanted.has(line.id));
  if (selected.length !== wanted.size) throw notFound("Ligne introuvable dans cette demande.");
  return selected;
}

type LinePatch = Partial<MaterialRequestLineData> & { status?: MaterialRequestLine["status"] };


function changes(line: MaterialRequestLine, patch: Partial<MaterialRequestLineData>, key: string): boolean {
  return key in patch && line[key as keyof MaterialRequestLineData] !== patch[key as keyof MaterialRequestLineData];
}

/**
 * What a line does not say: the duplicate acknowledgement, and its supplier, which is the office's purchasing
 * choice (TI-691) rather than what the technician asked. Changing them keeps a validated line validated; the line
 * trigger leaves them out of its backstop too.
 */
const NOT_WHAT_THE_LINE_SAYS: ReadonlySet<string> = new Set(["duplicate_acknowledged", "supplier_id"]);

/**
 * What a change does to one line, or null when it tells the line nothing new.
 *  - A validated line always describes what was validated: changing what it says (anything but the
 *    duplicate acknowledgement and the supplier) returns it to draft.
 *  - "Not a duplicate" was said of the piece the line described: changing its type, size, material, zone
 *    or imputation withdraws it, unless the same change says it again.
 */
function patchFor(line: MaterialRequestLine, patch: Partial<MaterialRequestLineData>): LinePatch | null {
  const changed = Object.keys(patch).filter((key) => changes(line, patch, key));
  if (changed.length === 0) return null;
  const result: LinePatch = { ...patch };
  if (line.status === "validated" && changed.some((key) => !NOT_WHAT_THE_LINE_SAYS.has(key))) result.status = "draft";
  if (line.duplicate_acknowledged && patch.duplicate_acknowledged === undefined
    && DUPLICATE_KEYS.some((key) => changed.includes(key))) {
    result.duplicate_acknowledged = false;
  }
  return result;
}

async function writeLines(
  access: MaterialRequestAccess,
  requestId: string,
  ids: readonly string[],
  patch: LinePatch,
  mapError: (error: SupabaseErrorLike) => ApiError | null = () => null,
): Promise<MaterialRequestLine[]> {
  if (ids.length === 0) return [];
  const { data, error } = await access.context.supabase
    .from("material_request_lines")
    .update(patch)
    .in("id", [...ids])
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .select(LINE_COLUMNS);
  if (error) throw mapError(error) ?? mapSupabaseError(error, "Impossible d'enregistrer les lignes.");
  if ((data ?? []).length !== ids.length) throw notFound("Ligne introuvable dans cette demande.");
  return data ?? [];
}

/** The selected lines as they are after the writes, in the order of the request. */
function afterWrites(selected: readonly MaterialRequestLine[], written: readonly MaterialRequestLine[]): MaterialRequestLine[] {
  const fresh = new Map(written.map((line) => [line.id, line]));
  return selected.map((line) => fresh.get(line.id) ?? line).sort(byPosition);
}

export async function updateMaterialRequestLine(
  projectId: string,
  requestId: string,
  lineId: string,
  input: MaterialRequestLineData,
): Promise<{ line: MaterialRequestLine }> {
  const access = await requireProjectAccess(projectId, "write");
  const [current] = selectLines(await readRequestLines(access, requestId), [lineId]);
  await assertSuppliersInTenant(access.context, [input.supplier_id]);
  // TI-691: a line priced by a retained quote keeps the quote's supplier and what it orders.
  const priced = pricedLineChanges([current], sent(input));
  if (priced) throw pricedLinesRefusal(priced.lines, priced.what);

  const patch = patchFor(current, sent(input));
  if (!patch) return { line: current };
  const [line] = await writeLines(access, requestId, [current.id], patch, pricedLineDatabaseRefusal([current]));
  return { line };
}

export async function bulkUpdateMaterialRequestLines(
  projectId: string,
  requestId: string,
  input: BulkUpdateMaterialRequestLinesData,
): Promise<{ lines: MaterialRequestLine[] }> {
  const access = await requireProjectAccess(projectId, "write");
  const selected = selectLines(await readRequestLines(access, requestId), input.ids);
  await assertSuppliersInTenant(access.context, [input.patch.supplier_id]);
  // All or nothing: one priced line whose supplier or order would change, and none of the selection is written.
  const priced = pricedLineChanges(selected, sent(input.patch));
  if (priced) throw pricedLinesRefusal(priced.lines, priced.what);

  // One statement per kind of line: those the change returns to draft, those whose kept duplicate it
  // asks again, both, or neither.
  const patch = sent(input.patch);
  const groups = new Map<string, { ids: string[]; patch: LinePatch }>();
  for (const line of selected) {
    const own = patchFor(line, patch);
    if (!own) continue;
    const key = `${own.status ?? ""}|${own.duplicate_acknowledged ?? ""}`;
    const group = groups.get(key) ?? { ids: [], patch: own };
    group.ids.push(line.id);
    groups.set(key, group);
  }
  const written: MaterialRequestLine[] = [];
  for (const group of groups.values()) {
    written.push(...(await writeLines(access, requestId, group.ids, group.patch, pricedLineDatabaseRefusal(selected))));
  }
  return { lines: afterWrites(selected, written) };
}

export async function deleteMaterialRequestLine(
  projectId: string,
  requestId: string,
  lineId: string,
): Promise<{ deleted: true }> {
  const access = await requireProjectAccess(projectId, "write");
  const { data: current, error: readError } = await access.context.supabase
    .from("material_request_lines")
    .select("id, position, price_quote_id")
    .eq("id", lineId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (readError) throw mapSupabaseError(readError, "Impossible de charger la ligne.");
  if (!current) throw notFound("Ligne introuvable dans cette demande.");
  if (current.price_quote_id !== null) throw pricedLinesRefusal([current], "delete");
  const { data, error } = await access.context.supabase
    .from("material_request_lines")
    .delete()
    .eq("id", lineId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .select("id")
    .maybeSingle();
  if (error) {
    // A quote retained by another session since the line was read.
    if (error.message === "MATERIAL_REQUEST_LINE_PRICED") throw pricedLinesRefusal([current], "delete");
    throw mapSupabaseError(error, "Impossible de supprimer la ligne.");
  }
  if (!data) throw notFound("Ligne introuvable dans cette demande.");
  return { deleted: true };
}

/** What the line trigger raises (SQLSTATE 23514) when a line would be validated in no material. */
const DATABASE_MATERIAL_REFUSALS: Record<string, MaterialRequestLineAlertCode | undefined> = {
  MATERIAL_REQUEST_LINE_MATERIAL_MISSING: "material_missing",
  MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED: "material_unconfirmed",
};

function linesBlocked(blocked: Array<{ id: string; codes: MaterialRequestLineAlertCode[] }>): ApiError {
  const held = blocked.length === 1 ? "1 ligne a" : `${blocked.length} lignes ont`;
  return unprocessableEntity(
    `Aucune ligne n’a été validée : ${held} encore une alerte bloquante.`,
    { blocked },
    MATERIAL_REQUEST_LINES_BLOCKED,
  );
}

/**
 * All or nothing: one requested line with a blocking alert and none is validated. The alerts are those
 * of alerts.ts, computed over every line of the request, since a duplicate may sit outside the selection.
 */
export async function validateMaterialRequestLines(
  projectId: string,
  requestId: string,
  ids: readonly string[],
): Promise<{ lines: MaterialRequestLine[] }> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const lines = await readRequestLines(access, request.id);
  const selected = selectLines(lines, ids).sort(byPosition);

  const alertContext: AlertContext = { request, lines };
  const blocked = selected
    .map((line) => ({ id: line.id, codes: blockingAlertCodes(line, alertContext) }))
    .filter((entry) => entry.codes.length > 0);
  if (blocked.length > 0) throw linesBlocked(blocked);

  // A line already validated keeps its own date and author.
  const pending = selected.filter((line) => line.status !== "validated");
  // The database has the last word on the material a line is validated in: if the request changed
  // since it was read, its refusal names the same lines as an alert would have.
  const refusedByDatabase = (error: SupabaseErrorLike) => {
    const code = DATABASE_MATERIAL_REFUSALS[error.message];
    if (error.code !== "23514" || !code) return null;
    return linesBlocked(pending.filter(reliesOnPresumedMaterial).map((line) => ({ id: line.id, codes: [code] })));
  };
  const written = await writeLines(access, request.id, pending.map((line) => line.id), { status: "validated" }, refusedByDatabase);
  return { lines: afterWrites(selected, written) };
}

export async function reopenMaterialRequestLines(
  projectId: string,
  requestId: string,
  ids: readonly string[],
): Promise<{ lines: MaterialRequestLine[] }> {
  const access = await requireProjectAccess(projectId, "write");
  const selected = selectLines(await readRequestLines(access, requestId), ids);
  const validated = selected.filter((line) => line.status === "validated").map((line) => line.id);
  return { lines: afterWrites(selected, await writeLines(access, requestId, validated, { status: "draft" })) };
}
