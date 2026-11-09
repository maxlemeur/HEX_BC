import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { selectInChunks } from "@/lib/supabase/in-chunks";
import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { catalogueFoTypeId, clearStaleFoPriceOrigin, readFoPriceOrigin, sameFoPriceSelection, type FoPriceLine } from "./fo-price-origin";

type Line = FoPriceLine & { supply_type_id?: string | null };
type Offer = { id: string; product_id: string; transport_mode: "included" | "excluded" | null };
type Product = { id: string; product_type: string | null; reference_transport_mode: string | null };
type SupplyType = { id: string; code: string; name: string };

/** SQL-trigger mirror. Batched preparation loads references once, never one HTTP call per line. */
export function createFoPriceResolver(supabase: SupabaseClient<Database>, tenantId: string) {
  const offers = new Map<string, Offer>();
  const products = new Map<string, Product>();
  const retained = new Set<string>();
  let types: SupplyType[] | undefined;

  async function preload(lines: readonly Line[]) {
    const offerIds = [...new Set(lines.map(line => line.selected_supplier_price_id).filter((id): id is string => Boolean(id)))];
    const tokens = [...new Set(lines.map(line => readFoPriceOrigin(line.fo_price_origin)?.selection_id).filter((id): id is string => Boolean(id)))];
    if (tokens.length) {
      const { data, error } = await readAllRowsInChunks(tokens, chunk =>
        supabase.from("estimate_items").select("id, fo_price_origin", { count: "exact" })
          .eq("tenant_id", tenantId).in("fo_price_origin->>selection_id", chunk));
      if (error) throw mapSupabaseError(error, "Impossible de lire la provenance conservée.");
      for (const row of data ?? []) {
        const origin = readFoPriceOrigin(row.fo_price_origin);
        if (origin) retained.add(JSON.stringify(origin));
      }
    }
    if (offerIds.length) {
      const { data, error } = await selectInChunks(offerIds, chunk => supabase.from("supplier_pricebook").select("id, product_id, transport_mode")
        .eq("tenant_id", tenantId).in("id", chunk));
      if (error) throw mapSupabaseError(error, "Impossible de lire le transport des offres.");
      for (const offer of data ?? []) offers.set(offer.id, offer);
    }
    const productIds = [...new Set([...lines.map(line => line.product_id), ...[...offers.values()].map(offer => offer.product_id)]
      .filter((id): id is string => Boolean(id)))];
    if (productIds.length) {
      const { data, error } = await selectInChunks(productIds, chunk => supabase.from("products").select("id, product_type, reference_transport_mode")
        .eq("tenant_id", tenantId).in("id", chunk));
      if (error) throw mapSupabaseError(error, "Impossible de lire les références de fourniture.");
      for (const product of data ?? []) products.set(product.id, product);
    }
    if (!types && lines.length) {
      const { data, error } = await readAllRows(() => supabase.from("supply_types").select("id, code, name", { count: "exact" }).eq("tenant_id", tenantId));
      if (error) throw mapSupabaseError(error, "Impossible de lire les types de fourniture.");
      types = data ?? [];
    }
  }

  async function resolve<T extends Line>(next: T, previous?: Line): Promise<T> {
    if (!previous && Object.hasOwn(next, "fo_price_origin") && next.fo_price_origin === null) return next;
    const origin = readFoPriceOrigin(next.fo_price_origin);
    const newOffer = Boolean(next.selected_supplier_price_id && next.selected_supplier_price_id !== previous?.selected_supplier_price_id);
    const newProduct = Boolean(next.product_id && next.product_id !== previous?.product_id);
    const selected = !previous || newOffer || newProduct || !sameFoPriceSelection(previous, next) && origin !== null;
    if (!selected) return previous ? clearStaleFoPriceOrigin(previous, next) : next;
    if (!types) await preload([next]);
    // Copies keep a snapshot already recorded in this tenant. Later catalogue edits are irrelevant.
    if (!previous && origin && retained.has(JSON.stringify(origin)) && (next.selected_supplier_price_id ? origin.kind === "supplier" && origin.source_id === next.selected_supplier_price_id : !next.product_id || origin.kind === "reference" && origin.source_id === next.product_id)) return next;
    if (!next.selected_supplier_price_id && !next.product_id) return { ...next, fo_price_origin: null };
    const offer = next.selected_supplier_price_id ? offers.get(next.selected_supplier_price_id) : null;
    if (next.selected_supplier_price_id && (!offer || next.product_id && next.product_id !== offer.product_id)) {
      throw badRequest("L’offre ne correspond pas à l’article de la ligne.");
    }
    const product = products.get(offer?.product_id ?? next.product_id ?? "");
    if (!product) throw badRequest("Article de fourniture invalide.");
    const mode = offer ? offer.transport_mode : product.reference_transport_mode;
    const sourceId = offer?.id ?? product.id;
    return { ...next,
      supply_type_id: !next.supply_type_id || previous && next.supply_type_id === previous.supply_type_id
        ? catalogueFoTypeId(product.product_type, types ?? []) : next.supply_type_id,
      fo_price_origin: { selection_id: origin?.selection_id ?? sourceId, kind: offer ? "supplier" : "reference",
        source_id: sourceId, transport_mode: mode === "included" || mode === "excluded" ? mode : null },
    };
  }
  return Object.assign(resolve, { preload });
}
