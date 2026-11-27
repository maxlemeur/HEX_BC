import type {
  BulkAssignResult,
  BulkValidateResult,
  CatalogueImportBatchPage,
  PendingReferencesQuery,
  PendingSupplierReferencePage,
  ReviewReferencesInput,
  ReviewReferencesResult,
  SupplierAlias,
  UndoImportResult,
} from "@/lib/catalogue/import-review-contract";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";

/** Browser-side calls of what follows an import of the costing workbook (TI-711): one HTTP request each. */

const JSON_HEADERS = { "Content-Type": "application/json" };

function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return requestJsonUncoordinated<T>(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }, fallback);
}

/** Remembers the workbook's name for a supplier; the same pair asked twice is one association. */
export async function rememberSupplierAlias(supplierId: string, alias: string): Promise<SupplierAlias> {
  const answer = await post<{ item: SupplierAlias }>(
    "/api/catalogue/supplier-aliases", { supplier_id: supplierId, alias }, "Ce nom n’a pas pu être associé au fournisseur.",
  );
  return answer.item;
}

export async function fetchSupplierAliases(signal?: AbortSignal): Promise<SupplierAlias[]> {
  const answer = await requestJsonUncoordinated<{ items: SupplierAlias[] }>(
    "/api/catalogue/supplier-aliases", { method: "GET", cache: "no-store", signal }, "Les noms associés n’ont pas pu être chargés.",
  );
  return answer.items ?? [];
}

export async function forgetSupplierAlias(aliasId: string): Promise<void> {
  await requestJsonUncoordinated<{ id: string }>(
    `/api/catalogue/supplier-aliases/${encodeURIComponent(aliasId)}`, { method: "DELETE" }, "Cette association n’a pas pu être retirée.",
  );
}

export function fetchPendingSupplierReferences(
  query: Partial<PendingReferencesQuery>,
  signal?: AbortSignal,
): Promise<PendingSupplierReferencePage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return requestJsonUncoordinated<PendingSupplierReferencePage>(
    `/api/catalogue/supplier-references?${params}`, { method: "GET", cache: "no-store", signal },
    "Les références à vérifier n’ont pas pu être chargées.",
  );
}

export function reviewSupplierReferences(input: ReviewReferencesInput): Promise<ReviewReferencesResult> {
  return post("/api/catalogue/supplier-references", input, "Ces références n’ont pas pu être vérifiées.");
}

export function validateDraftProducts(target: { ids: string[] } | { import_batch_id: string }): Promise<BulkValidateResult> {
  return post("/api/products/bulk", { action: "validate", ...target }, "Ces articles n’ont pas pu être validés.");
}

export function assignProductsSupplyType(ids: string[], supplyTypeId: string): Promise<BulkAssignResult> {
  return post(
    "/api/products/bulk", { action: "assign-supply-type", ids, supply_type_id: supplyTypeId },
    "La famille n’a pas pu être donnée à ces articles.",
  );
}

export function fetchCatalogueImportBatches(cursor?: string, signal?: AbortSignal): Promise<CatalogueImportBatchPage> {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
  return requestJsonUncoordinated<CatalogueImportBatchPage>(
    `/api/catalogue/import-batches${query}`, { method: "GET", cache: "no-store", signal }, "Les imports n’ont pas pu être chargés.",
  );
}

export function undoCatalogueImport(batchId: string): Promise<UndoImportResult> {
  return post(`/api/catalogue/import-batches/${encodeURIComponent(batchId)}/undo`, {}, "Cet import n’a pas pu être annulé.");
}
