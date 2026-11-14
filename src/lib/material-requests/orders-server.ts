import { z } from "zod";

import {
  type ApiError,
  type SupabaseErrorLike,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";

import type { MaterialRequestLine } from "./contracts";
import {
  MATERIAL_REQUEST_LINE_ALREADY_ORDERED,
  MATERIAL_REQUEST_LINE_ORDERED,
  MATERIAL_REQUEST_ORDER_BUSY,
  MATERIAL_REQUEST_ORDER_KEY_TAKEN,
  MATERIAL_REQUEST_ORDER_NOT_READY_REASONS,
  MATERIAL_REQUEST_ORDER_NOTHING_READY,
  MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE,
  MATERIAL_REQUEST_ORDERED,
  type CreateMaterialRequestOrdersData,
  type MaterialRequestOrdersCreated,
  type MaterialRequestOrdersSummary,
} from "./order-contracts";
import { linePositionsLabel, requireProjectAccess, requireRequest, type MaterialRequestAccess } from "./server-shared";

/**
 * Purchase orders from a material request (TI-691, lot 2 « l'achat », delivery 3a). Both database functions are
 * SECURITY DEFINER (an order is otherwise visible to its author and the admins only) and check the rights
 * themselves; they are checked here first so that a refusal has a status and a sentence. Every call names the active
 * tenant, the affaire and the request of the URL.
 */

const uuid = z.string().uuid();
const summarySchema: z.ZodType<MaterialRequestOrdersSummary> = z.object({
  ready_line_ids: z.array(uuid),
  not_ready: z.array(z.object({ line_id: uuid, reason: z.enum(MATERIAL_REQUEST_ORDER_NOT_READY_REASONS) })),
  ordered: z.array(z.object({
    line_id: uuid, purchase_order_id: uuid, purchase_order_reference: z.string(), status: z.string(), can_open: z.boolean(),
  })),
  orders: z.array(z.object({
    id: uuid, reference: z.string(), supplier_name: z.string(), status: z.string(),
    total_ht_cents: z.number().int(), line_count: z.number().int().min(0), can_open: z.boolean(),
  })),
  can_create: z.boolean(),
});
const createdSchema = z.object({
  replayed: z.boolean(),
  orders: z.array(z.object({
    id: uuid, reference: z.string(), supplier_name: z.string(), status: z.string(),
    line_count: z.number().int().min(1), total_ht_cents: z.number().int().min(0),
  })),
});

const REQUEST_NOT_FOUND = "Demande de matériel introuvable.";
const WRITERS_ONLY = "Vous ne pouvez pas commander les lignes de cette demande de matériel.";

function busy(): ApiError {
  return conflict("Une autre modification de cette demande était en cours : réessayez.", undefined, MATERIAL_REQUEST_ORDER_BUSY);
}

/** The refusals of both functions that the caller can act on, in French; null for anything else. */
function orderFunctionRefusal(error: SupabaseErrorLike): ApiError | null {
  if (error.code === "40P01" || error.code === "40001") return busy();
  switch (error.message) {
    case "MATERIAL_REQUEST_ORDER_NOT_FOUND":
      return notFound(REQUEST_NOT_FOUND);
    case "MATERIAL_REQUEST_ORDER_ACCESS_DENIED":
      return forbidden("Accès refusé à cette demande de matériel.");
    case "MATERIAL_REQUEST_ORDER_WRITERS_ONLY":
    case "PURCHASE_ORDER_ACCESS_DENIED":
    case "PURCHASE_ORDER_AUTH_REQUIRED":
      return forbidden(WRITERS_ONLY);
    case MATERIAL_REQUEST_ORDER_NOTHING_READY:
      return unprocessableEntity(
        "Aucune ligne de cette demande n’est prête à commander : chaque ligne doit être validée et chiffrée par un devis retenu.",
        undefined,
        MATERIAL_REQUEST_ORDER_NOTHING_READY,
      );
    case MATERIAL_REQUEST_LINE_ALREADY_ORDERED:
      return conflict(
        "Une ligne de cette demande vient d’être mise dans un bon de commande par ailleurs : rechargez la demande, puis réessayez.",
        undefined,
        MATERIAL_REQUEST_LINE_ALREADY_ORDERED,
      );
    case MATERIAL_REQUEST_ORDER_KEY_TAKEN:
      return conflict("Cette demande de commande a déjà été envoyée par un autre membre : rechargez la demande.", undefined,
        MATERIAL_REQUEST_ORDER_KEY_TAKEN);
    case "PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE":
      return unprocessableEntity("Le montant d’une ligne dépasse la capacité d’une commande : vérifiez sa quantité et son prix.");
    case MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE: {
      const names = parseNames(error.details);
      const subject = names.length === 1
        ? `Le fournisseur ${names[0]} est archivé : réactivez-le`
        : `Les fournisseurs ${names.join(", ")} sont archivés : réactivez-les`;
      return unprocessableEntity(`${subject} avant de commander ses lignes.`, { supplier_names: names },
        MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE);
    }
    default:
      return null;
  }
}

function parseNames(details: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(details ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

async function readSummary(access: MaterialRequestAccess, requestId: string): Promise<MaterialRequestOrdersSummary> {
  const { data, error } = await access.context.supabase.rpc("material_request_order_summary", { p_request_id: requestId });
  if (error) throw orderFunctionRefusal(error) ?? mapSupabaseError(error, "Impossible de charger les commandes de la demande.");
  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) throw internalError("La situation des commandes de la demande est incomplète.");
  return parsed.data;
}

/** The lines of a request that a standing purchase order holds (its summary's `ordered`), by id. */
export async function orderedLineIds(access: MaterialRequestAccess, requestId: string): Promise<Set<string>> {
  return new Set((await readSummary(access, requestId)).ordered.map((entry) => entry.line_id));
}

/** Where each line of the request stands for ordering, and the orders made from it. Readers of the request. */
export async function getMaterialRequestOrders(projectId: string, requestId: string): Promise<MaterialRequestOrdersSummary> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  return readSummary(access, request.id);
}

/**
 * One draft per supplier from the ready lines, overhead lines in their supplier's draft. The same key answers the
 * same drafts (`replayed`). Writers of the request who may also create orders: the owner of the affaire or an admin.
 */
export async function createMaterialRequestOrders(
  projectId: string,
  requestId: string,
  input: CreateMaterialRequestOrdersData,
): Promise<MaterialRequestOrdersCreated> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const { data, error } = await access.context.supabase.rpc("create_material_request_purchase_orders", {
    p_request_id: request.id,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw orderFunctionRefusal(error) ?? mapSupabaseError(error, "Impossible de créer les brouillons de commande.");
  const parsed = createdSchema.safeParse(data);
  if (!parsed.success) {
    throw internalError("Réponse de création invalide : vérifiez les commandes de la demande avant de réessayer.");
  }
  // Exactly the contract: the receipt also holds the lines and the tax of each draft.
  return {
    replayed: parsed.data.replayed,
    orders: parsed.data.orders.map(({ id, reference, supplier_name, status, line_count, total_ht_cents }) => ({
      id, reference, supplier_name, status, line_count, total_ht_cents,
    })),
  };
}

type LineRef = Pick<MaterialRequestLine, "id" | "position">;
type PricedLineRef = LineRef & Pick<MaterialRequestLine, "price_quote_id">;
type OrderedLineRef = LineRef & { reference: string };

/**
 * The lines among `candidates` that an order that is not canceled holds, with that order's reference. The database is
 * asked only when one of them is priced: a line is ordered only once a retained quote has priced it.
 */
export async function orderedAmong(
  access: MaterialRequestAccess,
  requestId: string,
  candidates: readonly PricedLineRef[],
): Promise<OrderedLineRef[]> {
  if (!candidates.some((line) => line.price_quote_id !== null)) return [];
  const held = new Map((await readSummary(access, requestId)).ordered.map((entry) => [entry.line_id, entry]));
  return candidates.flatMap((line) => {
    const order = held.get(line.id);
    return order ? [{ id: line.id, position: line.position, reference: order.purchase_order_reference }] : [];
  });
}

/** 409: a line in an order that stands does not return to draft (« La ligne 3 est dans le bon C-2611-004 … »). */
export function orderedLinesRefusal(lines: readonly OrderedLineRef[]): ApiError {
  const sorted = [...lines].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const positions = sorted.map((line) => line.position);
  const references = [...new Set(sorted.map((line) => line.reference))];
  const message = sorted.length === 1
    ? `La ligne ${positions[0]} est dans le bon ${references[0]} : elle ne peut plus être rouverte.`
    : `Les lignes ${linePositionsLabel(positions)} sont dans ${references.length === 1 ? "le bon" : "les bons"} ${references.join(", ")} : elles ne peuvent plus être rouvertes.`;
  return conflict(message, { line_ids: sorted.map((line) => line.id), positions, references }, MATERIAL_REQUEST_LINE_ORDERED);
}

/**
 * The database's own refusal (MATERIAL_REQUEST_LINE_ORDERED, DETAIL: the order's reference), when another session
 * ordered a line since it was read.
 */
export function orderedLineDatabaseRefusal(candidates: readonly PricedLineRef[]) {
  return (error: SupabaseErrorLike): ApiError | null => {
    if (error.message !== MATERIAL_REQUEST_LINE_ORDERED) return null;
    const priced = candidates.filter((line) => line.price_quote_id !== null);
    const reference = typeof error.details === "string" ? error.details : "";
    return priced.length === 1 && reference
      ? orderedLinesRefusal([{ id: priced[0].id, position: priced[0].position, reference }])
      : conflict("Une ligne est dans un bon de commande : elle ne peut plus être rouverte.", undefined, MATERIAL_REQUEST_LINE_ORDERED);
  };
}

/** 409 on the deletion of a request whose lines an order that stands holds (references unknown after a race). */
export function requestOrderedRefusal(references: readonly string[]): ApiError {
  const unique = [...new Set(references)];
  const where = unique.length === 0 ? "un bon de commande"
    : unique.length === 1 ? `le bon de commande ${unique[0]}` : `les bons de commande ${unique.join(", ")}`;
  return conflict(
    `Des lignes de cette demande sont dans ${where} : annulez-${unique.length > 1 ? "les" : "le"} ou supprimez le brouillon avant de supprimer la demande.`,
    { references: unique },
    MATERIAL_REQUEST_ORDERED,
  );
}
