import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";

type SupplierExportSearch = { ascii: string[]; unicode: string[] };
const MAX_INDEX_ROWS = 2000;

/** A bounded, request-local negative lookup index. It never ranks or selects an
 * offer: possible matches still go through the existing catalogue comparison. */
export async function loadSupplierExportSearch(): Promise<SupplierExportSearch | null> {
  const { supabase, tenantId } = await getAuthenticatedTenantContext();
  const limit = MAX_INDEX_ROWS + 1;
  const [products, suppliers, offers] = await Promise.all([
    readAllRows(() => supabase.from("products")
      .select("id, designation, reference, category, product_type, material, grade, dimensions, standard", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true), { limit }),
    readAllRows(() => supabase.from("suppliers").select("id, name", { count: "exact" })
      .eq("tenant_id", tenantId), { limit }),
    readAllRows(() => supabase.from("supplier_pricebook").select("id, supplier_sku", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true), { limit }),
  ]);
  for (const result of [products, suppliers, offers]) {
    if (result.error) throw mapSupabaseError(result.error, "Impossible de préparer les comparaisons de l'export.");
  }
  // A partial inventory must never justify omitting a supplier. Larger
  // catalogues keep the original comparison path, without changing its limits.
  if ([products, suppliers, offers].some(result => (result.count ?? limit) > MAX_INDEX_ROWS)) return null;

  const values = [
    ...(products.data ?? []).flatMap(row => Object.entries(row).filter(([key]) => key !== "id").map(([, value]) => value)),
    ...(suppliers.data ?? []).map(row => row.name),
    ...(offers.data ?? []).map(row => row.supplier_sku),
  ];
  const search: SupplierExportSearch = { ascii: [], unicode: [] };
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    // Over-approximation only: accents/compatibility folds may retain extra
    // candidates. Unknown Unicode stays uncertain and cannot exclude a query
    // without a literal numeric fragment that the value would have to contain.
    const folded = value.normalize("NFKD").toUpperCase().toLowerCase().replace(/\p{M}/gu, "");
    if (/^[\x20-\x7e]*$/.test(folded)) search.ascii.push(folded);
    else search.unicode.push(folded);
  }
  return search;
}

export function mayMatchSupplierExportSearch(search: SupplierExportSearch | null, title: string): boolean {
  if (!search) return true;
  const query = title.trim().replace(/\s+/g, " ").toLowerCase();
  // SQL strips punctuation from its ILIKE token. Preserve that path, as well
  // as non-ASCII queries, rather than guessing equivalent matching semantics.
  if (!/^[a-z0-9 ]+$/.test(query)) return true;
  if (search.ascii.some(value => value.includes(query))) return true;
  if (search.unicode.length === 0) return false;
  const digits = query.match(/[0-9]+/g)?.sort((a, b) => b.length - a.length)[0];
  return !digits || search.unicode.some(value => value.includes(digits));
}
