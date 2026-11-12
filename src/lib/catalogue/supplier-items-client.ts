import type { SupplyTypeListItem } from "@/lib/catalogue/supply-types";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";
import type {
  ArticleSupplierItem,
  SaveArticleSupplierItemInput,
} from "@/lib/material-requests/supplier-contracts";

/**
 * Browser-side calls for the suppliers of catalogue articles and the preferred supplier of supply types
 * (TI-691). Each function is one HTTP request; the screens show what the server answered.
 */

/**
 * An article's suppliers. `preferred_supplier_id`, the article's exception, is read here when the server
 * sends it: the catalogue page's list does not carry it.
 */
export type ArticleSuppliers = { items: ArticleSupplierItem[]; preferred_supplier_id?: string | null };

export type SupplyTypeWithPreferredSupplier = SupplyTypeListItem;

export type SupplierDirectoryEntry = { id: string; name: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

function productPath(productId: string, segment: string): string {
  return `/api/products/${encodeURIComponent(productId)}/${segment}`;
}

function read<T>(path: string, fallback: string, signal?: AbortSignal): Promise<T> {
  return requestJsonUncoordinated<T>(path, { method: "GET", cache: "no-store", signal }, fallback);
}

function write<T>(path: string, method: "PUT" | "PATCH", body: unknown, fallback: string): Promise<T> {
  return requestJsonUncoordinated<T>(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) }, fallback);
}

/** The server's sentence when it gave one, else the screen's. */
export function catalogueErrorMessage(error: unknown, fallback: string): string {
  if (isEstimateApiError(error) && error.message.trim().length > 0) return error.message;
  return fallback;
}

export async function fetchArticleSuppliers(productId: string, signal?: AbortSignal): Promise<ArticleSuppliers> {
  const answer = await read<ArticleSuppliers>(
    productPath(productId, "supplier-items"),
    "Les fournisseurs de l’article n’ont pas pu être chargés.",
    signal,
  );
  return { ...answer, items: answer.items ?? [] };
}

/**
 * Adds, changes or withdraws (`is_active: false`) the reference of an article at a supplier, never a
 * price. A key left out is saved as empty: send the reference and the address together.
 */
export async function saveArticleSupplierItem(
  productId: string,
  input: SaveArticleSupplierItemInput,
): Promise<ArticleSupplierItem> {
  const { item } = await write<{ item: ArticleSupplierItem }>(
    productPath(productId, "supplier-items"),
    "PUT",
    input,
    "Le fournisseur de l’article n’a pas pu être enregistré.",
  );
  return item;
}

/** Answers the exception the server now holds. */
export async function saveArticlePreferredSupplier(productId: string, supplierId: string | null): Promise<string | null> {
  const answer = await write<{ preferred_supplier_id?: string | null }>(
    productPath(productId, "preferred-supplier"),
    "PATCH",
    { preferred_supplier_id: supplierId },
    "Le fournisseur privilégié de l’article n’a pas pu être enregistré.",
  );
  return answer?.preferred_supplier_id !== undefined ? answer.preferred_supplier_id : supplierId;
}

export async function fetchSupplyTypesWithPreferredSupplier(
  signal?: AbortSignal,
): Promise<SupplyTypeWithPreferredSupplier[]> {
  const { items } = await read<{ items: SupplyTypeWithPreferredSupplier[] }>(
    "/api/catalogue/supply-types",
    "Les types de fourniture n’ont pas pu être chargés.",
    signal,
  );
  return items ?? [];
}

/** Answers the type as the server now holds it, or null when it sent nothing back. */
export async function saveSupplyTypePreferredSupplier(
  supplyTypeId: string,
  supplierId: string | null,
): Promise<SupplyTypeWithPreferredSupplier | null> {
  const answer = await write<{ item?: SupplyTypeWithPreferredSupplier }>(
    `/api/catalogue/supply-types/${encodeURIComponent(supplyTypeId)}`,
    "PATCH",
    { preferred_supplier_id: supplierId },
    "Le fournisseur privilégié du type n’a pas pu être enregistré.",
  );
  return answer?.item ?? null;
}

/** The tenant's active suppliers, by name, as the suppliers page lists them. */
export async function fetchSupplierDirectory(signal?: AbortSignal): Promise<SupplierDirectoryEntry[]> {
  const { items } = await read<{ items: SupplierDirectoryEntry[] }>(
    "/api/suppliers",
    "La liste des fournisseurs n’a pas pu être chargée.",
    signal,
  );
  return (items ?? []).map(({ id, name }) => ({ id, name }));
}

/** Only a web address is turned into a link: anything else typed in the field stays text. */
export function safeProductUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
