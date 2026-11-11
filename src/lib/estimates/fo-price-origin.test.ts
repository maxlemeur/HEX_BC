import { describe, expect, it } from "vitest";
import { parseEstimateBatchResponse } from "./batch-contracts";
import { clearStaleFoPriceOrigin, foCostBaseLabel, readFoPriceOrigin, readSiteCostSource, sameFoPriceSelection, selectedFoPriceOrigin, siteCostSourceText, siteFoPriceOrigin } from "./fo-price-origin";

const origin = { selection_id: "53400000-0000-4000-8000-000000000001", kind: "supplier", source_id: "53400000-0000-4000-8000-000000000002", transport_mode: "included" } as const;
const source = { unit_price_ht_cents: 10000, product_id: "product", selected_supplier_price_id: origin.source_id, fo_price_origin: origin };

describe("TI-534 retained price origin", () => {
  it("rejects incomplete or invalid origin metadata", () => {
    for (const value of [null, {}, { ...origin, transport_mode: "yes" }, { ...origin, selection_id: "arbitrary" }]) {
      expect(readFoPriceOrigin(value)).toBeNull();
    }
    expect(readFoPriceOrigin(origin)).toEqual(origin);
  });
  it("clears a retained transport when the price is edited manually even if the product remains", () => {
    expect(clearStaleFoPriceOrigin(source, { ...source, unit_price_ht_cents: 20000 }).fo_price_origin).toBeNull();
    expect(clearStaleFoPriceOrigin(source, { ...source, selected_supplier_price_id: null }).fo_price_origin).toBeNull();
    expect(clearStaleFoPriceOrigin(source, { ...source, fo_price_origin: null }).fo_price_origin).toBeNull();
  });
  it("keeps a deliberately refreshed offer even when its identifiers are unchanged", () => {
    const refreshed = { ...source, unit_price_ht_cents: 20000, fo_price_origin: { ...origin, selection_id: "53400000-0000-4000-8000-000000000003" } };
    expect(sameFoPriceSelection(source, refreshed)).toBe(false);
    expect(clearStaleFoPriceOrigin(source, refreshed)).toEqual(refreshed);
  });
  it("keeps the saved origin through quantity and unrelated edits", () => {
    const edited = { ...source, quantity: 10, k_fo: 0.9 };
    expect(clearStaleFoPriceOrigin(source, edited)).toBe(edited);
  });
});

// TI-541. Isolated: the shape of a site cost source is a pure contract shared with the SQL check; the journey
// SC54101 proves the same source through the editor, the reopening, the copy and the sealed quote.
describe("TI-541 site cost origin", () => {
  const site = { supplier: "Négoce Fictif", offer_reference: "OF-2611-07", offer_date: "2026-11-03", document: "Offre PDF du 03/11" };
  const siteOrigin = { selection_id: "54100000-0000-4000-8000-000000000001", kind: "site",
    source_id: "54100000-0000-4000-8000-000000000001", transport_mode: "included", site } as const;

  it("reads a site cost with its source and keeps the catalogue kinds unchanged", () => {
    expect(readFoPriceOrigin(siteOrigin)).toEqual(siteOrigin);
    expect(readSiteCostSource(siteOrigin)).toEqual(site);
    expect(readSiteCostSource(origin)).toBeNull();
    expect(readFoPriceOrigin(origin)).toEqual(origin);
  });
  it("rejects a site cost without a supplier, with a wrong date, a foreign source id, padding or extra keys", () => {
    for (const value of [
      { ...siteOrigin, site: { ...site, supplier: "" } },
      { ...siteOrigin, site: { ...site, supplier: " Comptoir" } },
      { ...siteOrigin, site: { ...site, supplier: "x".repeat(121) } },
      { ...siteOrigin, site: { ...site, offer_date: "2026-13-03" } },
      { ...siteOrigin, site: { ...site, offer_date: "03/11/2026" } },
      { ...siteOrigin, site: { ...site, document: "ligne\nsuivante" } },
      { ...siteOrigin, site: { ...site, catalogue: true } },
      { ...siteOrigin, source_id: "54100000-0000-4000-8000-000000000002" },
      { ...siteOrigin, site: undefined },
      { ...origin, site },
    ]) expect(readFoPriceOrigin(value)).toBeNull();
  });
  it("builds a fresh selection from the typed source, with optional fields left empty", () => {
    const built = siteFoPriceOrigin({ supplier: "  Négoce Fictif ", offerReference: " ", offerDate: "2026-11-03", document: null, transportIncluded: null });
    expect(built).toMatchObject({ kind: "site", transport_mode: null,
      site: { supplier: "Négoce Fictif", offer_reference: null, offer_date: "2026-11-03", document: null } });
    expect(built?.source_id).toBe(built?.selection_id);
    expect(siteFoPriceOrigin({ supplier: " ", offerDate: "2026-11-03", transportIncluded: true })).toBeNull();
    expect(siteFoPriceOrigin({ supplier: "Comptoir", offerDate: "2026-11-03", transportIncluded: false })?.transport_mode).toBe("excluded");
  });
  it("names the base of the cost and writes the source as saved", () => {
    expect(foCostBaseLabel({ fo_price_origin: siteOrigin, product_id: "product" })).toBe("Coût chantier");
    expect(foCostBaseLabel(source)).toBe("Offre fournisseur");
    expect(foCostBaseLabel({ fo_price_origin: { ...origin, kind: "reference" }, product_id: "product" })).toBe("Catalogue");
    expect(foCostBaseLabel({ unit_price_ht_cents: 900 })).toBe("Saisie manuelle");
    expect(siteCostSourceText(siteOrigin)).toBe("Négoce Fictif · offre OF-2611-07 · 03/11/2026 · Offre PDF du 03/11");
    expect(siteCostSourceText({ ...siteOrigin, site: { ...site, offer_reference: null, document: null } })).toBe("Négoce Fictif · 03/11/2026");
    expect(siteCostSourceText(origin)).toBe("");
  });
  it("drops the source when the cost is then retyped by hand, and keeps it through other edits", () => {
    const line = { unit_price_ht_cents: 900, product_id: "product", selected_supplier_price_id: null, fo_price_origin: siteOrigin };
    expect(clearStaleFoPriceOrigin(line, { ...line, unit_price_ht_cents: 910 }).fo_price_origin).toBeNull();
    const edited = { ...line, k_fo: 0.9 };
    expect(clearStaleFoPriceOrigin(line, edited)).toBe(edited);
  });
  it("keeps the source when the article is detached or deleted: its proof is the offer, not the catalogue", () => {
    const line = { unit_price_ht_cents: 900, product_id: "product", selected_supplier_price_id: null, fo_price_origin: siteOrigin };
    const detached = { ...line, product_id: null };
    expect(clearStaleFoPriceOrigin(line, detached)).toBe(detached);
    expect(clearStaleFoPriceOrigin(line, { ...detached, unit_price_ht_cents: 910 }).fo_price_origin).toBeNull();
    // A catalogue origin still falls with its article.
    expect(clearStaleFoPriceOrigin(source, { ...source, product_id: null }).fo_price_origin).toBeNull();
  });
  // The browser compares the receipt of a save with what it sent, key order included, and a receipt comes back
  // from jsonb in another order. Reading an origin must therefore give back the order the editor writes.
  it("reads every kind back in the key order the editor sends, so a save receipt is recognised", () => {
    const ids = { version: "11111111-1111-4111-8111-111111111111", item: "22222222-2222-4222-8222-222222222222",
      actor: "33333333-3333-4333-8333-333333333333", key: "55555555-5555-4555-8555-555555555555" };
    const sent = [
      selectedFoPriceOrigin({ supplier_price_id: origin.source_id, product_id: origin.source_id, transport_mode: "included" }),
      selectedFoPriceOrigin({ price_source: "reference", product_id: origin.source_id, transport_mode: null }),
      siteFoPriceOrigin({ supplier: "Négoce Fictif", offerDate: "2026-11-03", transportIncluded: true }),
    ];
    for (const value of sent) {
      expect(value).not.toBeNull();
      expect(JSON.stringify(readFoPriceOrigin(value))).toBe(JSON.stringify(value));
      const operations = [{ op: "update" as const, id: ids.item, data: { unit_price_ht_cents: 900, fo_price_origin: value } }];
      // jsonb returns object keys by length, then alphabetically.
      const stored = JSON.parse(JSON.stringify(operations), (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) : entry);
      const answer = { committed: true, version: { id: ids.version, updated_at: "2026-10-28T10:00:00.000002Z" },
        results: [{ index: 0, op: "update", status: "ok", data: { item: { id: ids.item, version_id: ids.version, item_type: "line", quantity: 1,
          unit_price_ht_cents: 900, pu_ht_cents: 900, line_total_ht_cents: 900, line_tax_cents: 180, line_total_ttc_cents: 1080,
          fo_price_origin: value } } }],
        totals: { total_ht_cents: 900, total_tax_cents: 180, total_ttc_cents: 1080 },
        receipt: { operation_key: ids.key, actor_id: ids.actor, version_id: ids.version, expected_updated_at: "2026-10-28T10:00:00.000001Z",
          committed_at: "2026-10-28T10:00:00.000002Z", operations: stored },
        replayed: false, current_version: { id: ids.version, updated_at: "2026-10-28T10:00:00.000002Z", status: "draft" } };
      expect(() => parseEstimateBatchResponse(answer, { versionId: ids.version, actorId: ids.actor, operationKey: ids.key,
        expectedUpdatedAt: "2026-10-28T10:00:00.000001Z", operations })).not.toThrow();
    }
  });
});
