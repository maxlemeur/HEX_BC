import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createFoPriceResolver } from "./fo-price-origin-server";

// TI-541. Isolated: the resolver is the TypeScript mirror of the SQL trigger. A site cost must be kept without
// any catalogue read, which only a client that refuses every read can prove. The SQL side is proven in
// supabase/tests/database/estimate-fo-provision.test.sql and the whole path in journey SC54101.
const noCatalogue = new Proxy({}, { get() { throw new Error("A site cost must not read the catalogue."); } }) as SupabaseClient<Database>;
const siteOrigin = { selection_id: "54100000-0000-4000-8000-000000000001", kind: "site",
  source_id: "54100000-0000-4000-8000-000000000001", transport_mode: "included",
  site: { supplier: "Négoce Fictif", offer_reference: "OF-2611-07", offer_date: "2026-11-03", document: null } } as const;
const product = "54100000-0000-4000-8000-000000000051";
const current = { unit_price_ht_cents: 1000, product_id: product, selected_supplier_price_id: null, supply_type_id: "tube",
  fo_price_origin: { selection_id: product, kind: "reference", source_id: product, transport_mode: null } };

describe("TI-541 site cost in the price resolver", () => {
  it("keeps a site cost typed on a catalogue line, without reading the catalogue or changing the supply type", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    const next = { ...current, unit_price_ht_cents: 900, fo_price_origin: siteOrigin };
    expect(await resolve(next, current)).toEqual(next);
  });
  it("keeps a site cost on a created line (copy of a line or of a section)", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    const created = { unit_price_ht_cents: 900, product_id: product, selected_supplier_price_id: null, fo_price_origin: siteOrigin };
    expect(await resolve(created)).toEqual(created);
  });
  it("refuses a site cost that keeps a catalogue offer selected", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    await expect(resolve({ ...current, selected_supplier_price_id: "54100000-0000-4000-8000-000000000053", fo_price_origin: siteOrigin },
      { ...current, selected_supplier_price_id: "54100000-0000-4000-8000-000000000053" })).rejects.toMatchObject({ status: 400 });
  });
  it("drops the source when the cost is retyped by hand afterwards", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    const saved = { ...current, unit_price_ht_cents: 900, fo_price_origin: siteOrigin };
    expect((await resolve({ ...saved, unit_price_ht_cents: 910 }, saved)).fo_price_origin).toBeNull();
    expect((await resolve({ ...saved, k_fo: 0.9 } as typeof saved, saved)).fo_price_origin).toEqual(siteOrigin);
  });
  it("keeps the source when the article of the line is detached", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    const saved = { ...current, unit_price_ht_cents: 900, fo_price_origin: siteOrigin };
    expect(await resolve({ ...saved, product_id: null }, saved)).toEqual({ ...saved, product_id: null });
  });
  it("reads a site source edited under the same selection as a new site cost, like the SQL trigger", async () => {
    const resolve = createFoPriceResolver(noCatalogue, "tenant");
    const saved = { ...current, unit_price_ht_cents: 900, fo_price_origin: siteOrigin };
    const edited = { ...saved, unit_price_ht_cents: 880, fo_price_origin: { ...siteOrigin, transport_mode: "excluded" } };
    expect(await resolve(edited, saved)).toEqual(edited);
  });
});
