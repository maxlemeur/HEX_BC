import {
  type ApiError,
  type SupabaseErrorLike,
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { Json } from "@/types/database";

import type { MaterialRequest, MaterialRequestFile, MaterialRequestLine } from "./contracts";
import {
  MATERIAL_REQUEST_QUOTE_BUSY,
  MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED,
  MATERIAL_REQUEST_QUOTE_LINES_UNPRICED,
  MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED,
  MATERIAL_REQUEST_QUOTE_NOT_RECEIVED,
  MATERIAL_REQUEST_QUOTE_READ_ONLY,
  MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN,
  MATERIAL_REQUEST_QUOTE_WITHOUT_LINES,
  type CreateQuoteData,
  type MaterialRequestQuote,
  type MaterialRequestQuoteLine,
  type MaterialRequestQuoteRetained,
  type MaterialRequestQuoteStatus,
  type UpdateQuoteData,
} from "./quote-contracts";
import {
  FILE_COLUMNS,
  linePositionsLabel,
  readRequestLines,
  requireProjectAccess,
  requireRequest,
  type MaterialRequestAccess,
} from "./server-shared";

/**
 * Consulting suppliers for a material request (TI-691, lot 2 « l'achat », delivery 2 « consultation »). The office
 * records the message it copied into WhatsApp as a quote asked of one supplier for some lines, records the answer
 * (prices per line, total, notes, files), then retains one quote: its lines take its supplier and their unit price,
 * and the other quotes in progress sharing a line are closed. Every write goes through one database function or one
 * statement, as the caller (RLS); the rights are checked here first so that a refusal has a status and a sentence,
 * and the database (policies, triggers, functions) has the last word. Every query names the active tenant, the
 * affaire and the request of the URL. Files of a quote are written by files-server.ts (`quote_id`).
 */

const QUOTE_COLUMNS =
  "id, request_id, supplier_id, status, with_references, message, requested_at, received_at, amount_ht_cents, notes, retained_at, closed_at";
const QUOTE_NOT_FOUND = "Devis introuvable dans cette demande.";
const LINE_NOT_FOUND = "Ligne introuvable dans cette demande.";
const SUPPLIER_NOT_FOUND = "Fournisseur introuvable.";
const OPEN_STATUSES: readonly MaterialRequestQuoteStatus[] = ["requested", "received"];
/** Quote ids per filter of the quote lines: a request rarely has more quotes; each page holds 1 000 rows. */
const QUOTE_IDS_PER_READ = 100;
const QUOTE_LINES_PAGE = 1000;

type QuoteRow = Omit<MaterialRequestQuote, "supplier_name" | "lines" | "files">;
type QuoteLineRow = MaterialRequestQuoteLine & { quote_id: string };
type LineRef = Pick<MaterialRequestLine, "id" | "position">;

/**
 * The database ended a deadlock between two writes of the same request (a retaining and a validation of a shared
 * line, for instance): nothing of this one was written, and trying again succeeds.
 */
export function quoteWriteBusy(error: SupabaseErrorLike): ApiError | null {
  return error.code === "40P01" || error.code === "40001"
    ? conflict("Une autre modification était en cours : réessayez.", undefined, MATERIAL_REQUEST_QUOTE_BUSY)
    : null;
}

/** A retained or closed quote is read-only, its files included. */
export function quoteReadOnly(status: "retained" | "closed"): ApiError {
  return conflict(
    status === "retained" ? "Ce devis est retenu : il ne se modifie plus." : "Ce devis est clos : il ne se modifie plus.",
    { status },
    MATERIAL_REQUEST_QUOTE_READ_ONLY,
  );
}

/** A quote of the request of the URL, or 404: a quote of another request is not found here. */
export async function requireQuote(access: MaterialRequestAccess, requestId: string, quoteId: string): Promise<QuoteRow> {
  const { data, error } = await access.context.supabase
    .from("material_request_quotes")
    .select(QUOTE_COLUMNS)
    .eq("id", quoteId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger le devis.");
  if (!data) throw notFound(QUOTE_NOT_FOUND);
  return data;
}

/** A quote still in progress (requested or received), or why it is read-only. */
export async function requireOpenQuote(access: MaterialRequestAccess, requestId: string, quoteId: string): Promise<QuoteRow> {
  const quote = await requireQuote(access, requestId, quoteId);
  if (quote.status === "retained" || quote.status === "closed") throw quoteReadOnly(quote.status);
  return quote;
}

function byPosition(left: LineRef, right: LineRef): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function positionsOf(lines: readonly LineRef[]) {
  const sorted = [...lines].sort(byPosition);
  return { positions: sorted.map((line) => line.position), line_ids: sorted.map((line) => line.id) };
}

/** The lines of some quotes, page by page: a quote holds 300 lines at most, a request any number of quotes. */
async function readQuoteLines(access: MaterialRequestAccess, quoteIds: readonly string[]): Promise<QuoteLineRow[]> {
  const { supabase, tenantId } = access.context;
  const rows: QuoteLineRow[] = [];
  const unique = [...new Set(quoteIds)];
  for (let first = 0; first < unique.length; first += QUOTE_IDS_PER_READ) {
    const chunk = unique.slice(first, first + QUOTE_IDS_PER_READ);
    const chunkRows: QuoteLineRow[] = [];
    let expected: number | null = null;
    while (expected === null || chunkRows.length < expected) {
      const start = chunkRows.length;
      const { data, error, count } = await supabase
        .from("material_request_quote_lines")
        .select("quote_id, line_id, unit_price_ht_cents, price_per", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("project_id", access.project.id)
        .in("quote_id", chunk)
        .order("quote_id", { ascending: true })
        .order("line_id", { ascending: true })
        .range(start, start + QUOTE_LINES_PAGE - 1);
      if (error) throw mapSupabaseError(error, "Impossible de charger les lignes des devis.");
      if (typeof count !== "number" || (expected !== null && count !== expected)) {
        throw new Error("Lecture incomplète ou modifiée : lignes des devis.");
      }
      expected = count;
      const page = data ?? [];
      if (page.length === 0 && chunkRows.length < expected) throw new Error("Lecture incomplète : lignes des devis.");
      chunkRows.push(...page);
    }
    rows.push(...chunkRows);
  }
  return rows;
}

/** Quotes as the screen shows them: newest first, with the supplier's name, lines in the request's order and files. */
async function readQuotes(access: MaterialRequestAccess, requestId: string, onlyIds?: readonly string[]): Promise<MaterialRequestQuote[]> {
  const { supabase, tenantId } = access.context;
  const { data: quoteRows, error } = await readAllRows(() => {
    const query = supabase
      .from("material_request_quotes")
      .select(QUOTE_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId);
    return onlyIds ? query.in("id", [...onlyIds]) : query;
  });
  if (error) throw mapSupabaseError(error, "Impossible de charger les devis de la demande.");
  const quotes = quoteRows ?? [];
  if (quotes.length === 0) return [];

  const [quoteLines, lines, files, suppliers] = await Promise.all([
    readQuoteLines(access, quotes.map((quote) => quote.id)),
    readAllRows(() => supabase
      .from("material_request_lines")
      .select("id, position", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId)),
    // The files a reader sees: stored, and whose deletion has not begun.
    readAllRows(() => supabase
      .from("material_request_files")
      .select(FILE_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId)
      .not("quote_id", "is", null)
      .not("stored_at", "is", null)
      .is("removed_at", null)),
    readAllRowsInChunks([...new Set(quotes.map((quote) => quote.supplier_id))], (chunk) => supabase
      .from("suppliers")
      .select("id, name", { count: "exact" })
      .eq("tenant_id", tenantId)
      .in("id", chunk)),
  ]);
  if (lines.error) throw mapSupabaseError(lines.error, "Impossible de charger les lignes de la demande.");
  if (files.error) throw mapSupabaseError(files.error, "Impossible de charger les fichiers des devis.");
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de charger les fournisseurs.");

  const positions = new Map((lines.data ?? []).map((line) => [line.id, line.position]));
  const names = new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier.name]));
  const linesOf = new Map<string, QuoteLineRow[]>();
  for (const row of quoteLines) linesOf.set(row.quote_id, [...(linesOf.get(row.quote_id) ?? []), row]);
  const filesOf = new Map<string, MaterialRequestFile[]>();
  for (const file of files.data ?? []) {
    if (file.quote_id) filesOf.set(file.quote_id, [...(filesOf.get(file.quote_id) ?? []), file]);
  }
  const position = (lineId: string) => positions.get(lineId) ?? Number.MAX_SAFE_INTEGER;

  return quotes
    .map((quote) => ({
      ...quote,
      supplier_name: names.get(quote.supplier_id) ?? "",
      lines: (linesOf.get(quote.id) ?? [])
        .sort((left, right) => position(left.line_id) - position(right.line_id) || left.line_id.localeCompare(right.line_id))
        .map((row) => ({ line_id: row.line_id, unit_price_ht_cents: row.unit_price_ht_cents, price_per: row.price_per })),
      files: (filesOf.get(quote.id) ?? [])
        .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => Date.parse(right.requested_at) - Date.parse(left.requested_at) || left.id.localeCompare(right.id));
}

async function readQuote(access: MaterialRequestAccess, requestId: string, quoteId: string): Promise<MaterialRequestQuote> {
  const [quote] = await readQuotes(access, requestId, [quoteId]);
  if (!quote) throw notFound(QUOTE_NOT_FOUND);
  return quote;
}

/** Every quote of the request, closed and retained included, newest first. */
export async function listMaterialRequestQuotes(projectId: string, requestId: string): Promise<{ items: MaterialRequestQuote[] }> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  return { items: await readQuotes(access, request.id) };
}

function supplierInProgress(): ApiError {
  return conflict(
    "Une consultation de ce fournisseur est déjà en cours pour cette demande : clôturez-la avant d’en ouvrir une autre.",
    undefined,
    MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN,
  );
}

function alreadyRetained(lines: readonly LineRef[]): ApiError {
  const { positions, line_ids } = positionsOf(lines);
  const message = positions.length === 1
    ? `La ligne ${linePositionsLabel(positions)} a déjà un devis retenu : elle n’est plus à consulter.`
    : `Les lignes ${linePositionsLabel(positions)} ont déjà un devis retenu : elles ne sont plus à consulter.`;
  return unprocessableEntity(message, { positions, line_ids }, MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED);
}

/** A quote of this supplier still in progress on the request, if any. */
async function hasQuoteInProgress(access: MaterialRequestAccess, requestId: string, supplierId: string): Promise<boolean> {
  const { data, error } = await access.context.supabase
    .from("material_request_quotes")
    .select("id")
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .eq("supplier_id", supplierId)
    .in("status", [...OPEN_STATUSES])
    .limit(1);
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les consultations du fournisseur.");
  return (data ?? []).length > 0;
}

/**
 * Records the quote asked of a supplier for lines of the request, with the message as it was copied (status
 * requested). Refused for a supplier of another tenant (404) or archived (400), a line of another request (404) or
 * already priced by a retained quote (422), and while the supplier has a quote in progress on the request (409).
 */
export async function createMaterialRequestQuote(
  projectId: string,
  requestId: string,
  input: CreateQuoteData,
): Promise<{ item: MaterialRequestQuote }> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const { context } = access;

  const { data: supplier, error: supplierError } = await context.supabase
    .from("suppliers")
    .select("id, is_active")
    .eq("id", input.supplier_id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (supplierError) throw mapSupabaseError(supplierError, "Impossible de vérifier le fournisseur.");
  if (!supplier) throw notFound(SUPPLIER_NOT_FOUND);
  if (!supplier.is_active) throw badRequest("Ce fournisseur est archivé : réactivez-le avant de le consulter.");

  const lines = new Map((await readRequestLines(access, request.id)).map((line) => [line.id, line]));
  const asked = input.line_ids.map((lineId) => lines.get(lineId));
  if (asked.some((line) => line === undefined)) throw notFound(LINE_NOT_FOUND);
  const priced = asked.filter((line): line is MaterialRequestLine => line !== undefined && line.price_quote_id !== null);
  if (priced.length > 0) throw alreadyRetained(priced);
  if (await hasQuoteInProgress(access, request.id, supplier.id)) throw supplierInProgress();

  const { data: quoteId, error } = await context.supabase.rpc("create_material_request_quote", {
    p_request_id: request.id,
    p_supplier_id: supplier.id,
    p_with_references: input.with_references,
    p_message: input.message,
    p_line_ids: input.line_ids,
  });
  if (error) {
    const busy = quoteWriteBusy(error);
    if (busy) throw busy;
    // Another session consulted the supplier, deleted a line or retained a quote for one since they were read.
    if (error.code === "23505") throw supplierInProgress();
    if (error.message === "MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_REQUEST") throw notFound(LINE_NOT_FOUND);
    if (error.message === "MATERIAL_REQUEST_TENANT_MISMATCH") throw notFound(SUPPLIER_NOT_FOUND);
    if (error.message === "MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED") {
      const fresh = (await readRequestLines(access, request.id))
        .filter((line) => input.line_ids.includes(line.id) && line.price_quote_id !== null);
      if (fresh.length > 0) throw alreadyRetained(fresh);
    }
    throw mapSupabaseError(error, "Impossible d'enregistrer le devis.");
  }
  return { item: await readQuote(access, request.id, quoteId) };
}

/** The 404 of lines the quote does not ask for, naming those that are lines of the request. */
async function linesNotInQuote(access: MaterialRequestAccess, requestId: string, lineIds: readonly string[]): Promise<ApiError> {
  const lines = (await readRequestLines(access, requestId)).filter((line) => lineIds.includes(line.id));
  if (lines.length < new Set(lineIds).size) return notFound(LINE_NOT_FOUND);
  const { positions, line_ids } = positionsOf(lines);
  return notFound(
    positions.length === 1
      ? `La ligne ${linePositionsLabel(positions)} n’est pas demandée dans ce devis.`
      : `Les lignes ${linePositionsLabel(positions)} ne sont pas demandées dans ce devis.`,
    { positions, line_ids },
  );
}

/** Refusals of the quote functions that the caller can act on, from the quote as it now stands. */
async function quoteFunctionRefusal(
  access: MaterialRequestAccess,
  requestId: string,
  quoteId: string,
  error: SupabaseErrorLike,
): Promise<ApiError | null> {
  if (error.message === "MATERIAL_REQUEST_QUOTE_NOT_FOUND") return notFound(QUOTE_NOT_FOUND);
  if (error.message === "MATERIAL_REQUEST_QUOTE_WRITERS_ONLY") {
    return forbidden("Vous ne pouvez pas modifier les demandes de matériel de cette affaire.");
  }
  if (error.message === "MATERIAL_REQUEST_QUOTE_READ_ONLY" || error.message === "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED") {
    const quote = await requireQuote(access, requestId, quoteId);
    if (quote.status === "retained" || quote.status === "closed") return quoteReadOnly(quote.status);
  }
  return null;
}

/**
 * Prices, total, notes and reception of a quote still in progress, in one database call: a key left out is left
 * alone, null clears it, `received: true` marks it received (the database dates it). Each priced line is one of the
 * quote's (404 otherwise); a retained or closed quote is read-only (409).
 */
export async function updateMaterialRequestQuote(
  projectId: string,
  requestId: string,
  quoteId: string,
  input: UpdateQuoteData,
): Promise<{ item: MaterialRequestQuote }> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const quote = await requireOpenQuote(access, request.id, quoteId);

  if (input.lines) {
    const asked = new Set((await readQuoteLines(access, [quote.id])).map((row) => row.line_id));
    const missing = input.lines.map((entry) => entry.line_id).filter((lineId) => !asked.has(lineId));
    if (missing.length > 0) throw await linesNotInQuote(access, request.id, missing);
  }

  const changes: { [key: string]: Json } = {};
  if (input.amount_ht_cents !== undefined) changes.amount_ht_cents = input.amount_ht_cents;
  if (input.notes !== undefined) changes.notes = input.notes;
  if (input.lines !== undefined) changes.lines = input.lines;
  if (input.received) changes.received = true;

  const { error } = await access.context.supabase.rpc("update_material_request_quote", {
    p_quote_id: quote.id,
    p_changes: changes,
  });
  if (error) {
    const busy = quoteWriteBusy(error);
    if (busy) throw busy;
    if (error.message === "MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE") {
      throw await linesNotInQuote(access, request.id, (input.lines ?? []).map((entry) => entry.line_id));
    }
    throw (await quoteFunctionRefusal(access, request.id, quote.id, error))
      ?? mapSupabaseError(error, "Impossible d'enregistrer le devis.");
  }
  return { item: await readQuote(access, request.id, quote.id) };
}

/** Why a quote cannot be retained as it now stands, or null. */
async function retainRefusal(access: MaterialRequestAccess, request: MaterialRequest, quote: QuoteRow): Promise<ApiError | null> {
  const requestId = request.id;
  if (quote.status === "retained" || quote.status === "closed") return quoteReadOnly(quote.status);
  if (quote.status !== "received") {
    return unprocessableEntity(
      "Ce devis n’est pas encore reçu : enregistrez la réponse du fournisseur avant de le retenir.",
      { status: quote.status },
      MATERIAL_REQUEST_QUOTE_NOT_RECEIVED,
    );
  }
  const [quoteLines, lines] = await Promise.all([readQuoteLines(access, [quote.id]), readRequestLines(access, requestId)]);
  if (quoteLines.length === 0) {
    return unprocessableEntity("Ce devis ne demande plus aucune ligne : il n’y a rien à retenir.", undefined, MATERIAL_REQUEST_QUOTE_WITHOUT_LINES);
  }
  const byId = new Map(lines.map((line) => [line.id, line]));
  const asked = quoteLines.flatMap((row) => byId.get(row.line_id) ?? []);
  const unpricedIds = new Set(quoteLines.filter((row) => row.unit_price_ht_cents === null).map((row) => row.line_id));
  const unpriced = asked.filter((line) => unpricedIds.has(line.id));
  if (unpriced.length > 0) {
    const { positions, line_ids } = positionsOf(unpriced);
    return unprocessableEntity(
      positions.length === 1
        ? `La ligne ${linePositionsLabel(positions)} de ce devis n’a pas de prix : chiffrez-la avant de le retenir.`
        : `Les lignes ${linePositionsLabel(positions)} de ce devis n’ont pas de prix : chiffrez-les avant de le retenir.`,
      { positions, line_ids },
      MATERIAL_REQUEST_QUOTE_LINES_UNPRICED,
    );
  }
  const priced = asked.filter((line) => line.price_quote_id !== null && line.price_quote_id !== quote.id);
  if (priced.length > 0) return alreadyRetained(priced);
  // A project line without its own material was consulted in the request's presumed material: the retaining writes
  // that material on it, so that its price stays tied to it, and only once the office has confirmed it.
  const unconfirmed = asked.filter((line) => line.imputation === "project" && !(line.material ?? "").trim());
  if (unconfirmed.length > 0 && (!(request.presumed_material ?? "").trim() || !request.material_confirmed)) {
    const { positions, line_ids } = positionsOf(unconfirmed);
    return unprocessableEntity(
      positions.length === 1
        ? `La ligne ${linePositionsLabel(positions)} n’a pas de matière propre et la matière présumée de la demande n’est pas confirmée : confirmez-la avant de retenir ce devis.`
        : `Les lignes ${linePositionsLabel(positions)} n’ont pas de matière propre et la matière présumée de la demande n’est pas confirmée : confirmez-la avant de retenir ce devis.`,
      { positions, line_ids },
      MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED,
    );
  }
  return null;
}

/**
 * Retains a received quote whose lines are all priced, in one database transaction: its lines take its supplier,
 * their unit price and the quote (a validated line stays validated), and the other quotes in progress sharing a line
 * with it are closed. 422 for a quote not received yet or with an unpriced line (named by its number), 409 for one
 * already retained or closed.
 */
export async function retainMaterialRequestQuote(
  projectId: string,
  requestId: string,
  quoteId: string,
): Promise<MaterialRequestQuoteRetained> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const quote = await requireQuote(access, request.id, quoteId);
  const refusal = await retainRefusal(access, request, quote);
  if (refusal) throw refusal;

  const { data, error } = await access.context.supabase.rpc("retain_material_request_quote", { p_quote_id: quote.id });
  if (error) {
    const busy = quoteWriteBusy(error);
    if (busy) throw busy;
    // Another session changed the quote or its lines since they were read: the refusal says what stands now.
    if (error.code === "23514" && error.message.startsWith("MATERIAL_REQUEST_QUOTE_")) {
      const now = await retainRefusal(access, await requireRequest(access, request.id), await requireQuote(access, request.id, quote.id));
      if (now) throw now;
      throw conflict("Le devis ou ses lignes ont changé entre-temps : rechargez la demande, puis réessayez.");
    }
    throw (await quoteFunctionRefusal(access, request.id, quote.id, error))
      ?? mapSupabaseError(error, "Impossible de retenir le devis.");
  }

  const item = await readQuote(access, request.id, quote.id);
  const asked = new Set(item.lines.map((line) => line.line_id));
  return {
    item,
    lines: (await readRequestLines(access, request.id)).filter((line) => asked.has(line.id)),
    closed_quote_ids: (data ?? []).map((row) => row.closed_quote_id),
  };
}

/** Closes a quote in progress by hand; a closed one is answered as it is, a retained one is refused (409). */
export async function closeMaterialRequestQuote(
  projectId: string,
  requestId: string,
  quoteId: string,
): Promise<{ item: MaterialRequestQuote }> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const quote = await requireQuote(access, request.id, quoteId);
  if (quote.status === "retained") throw quoteReadOnly("retained");
  if (quote.status === "closed") return { item: await readQuote(access, request.id, quote.id) };

  const { data, error } = await access.context.supabase
    .from("material_request_quotes")
    .update({ status: "closed" })
    .eq("id", quote.id)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", request.id)
    .in("status", [...OPEN_STATUSES])
    .select("id");
  if (error) {
    throw quoteWriteBusy(error) ?? (await quoteFunctionRefusal(access, request.id, quote.id, error))
      ?? mapSupabaseError(error, "Impossible de clôturer le devis.");
  }
  // Nothing reached: another session retained it (refused) or closed it (done) meanwhile.
  if ((data ?? []).length === 0) {
    const now = await requireQuote(access, request.id, quote.id);
    if (now.status === "retained") throw quoteReadOnly("retained");
  }
  return { item: await readQuote(access, request.id, quote.id) };
}
