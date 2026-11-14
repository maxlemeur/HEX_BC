import { describe, expect, it } from "vitest";

import { supplierPickerLabels, type SupplierIdentity } from "./supplier-labels";

/**
 * Failure modes (TI-691, the owner's walk of 2026-11-14: « Best Supplier » three times in the supplier menu).
 * Suppliers are fictional.
 *  1. Two suppliers of the same name read the same in a picker, so the office cannot tell which it chooses;
 *     names that differ only by letter case, accents or spaces count as the same name to a reader.
 *  2. A supplier whose name is its own alone is shown with a mark it does not need.
 *  3. The mark given does not tell the homonyms apart (two in the same city get the city), or a missing
 *     city, e-mail or SIRET leaves one without a mark.
 *  4. A homonym is dropped or merged: every supplier stays one choice.
 */

const supplier = (id: string, name: string, extra: Partial<SupplierIdentity> = {}): SupplierIdentity => ({
  id, name, city: null, email: null, siret: null, created_at: "2026-10-20T08:00:00.000Z", ...extra,
});

describe("supplierPickerLabels", () => {
  it("keeps the name alone for a supplier no other shares", () => {
    const labels = supplierPickerLabels([supplier("a1", "Négoce Alpha", { city: "Lyon" }), supplier("b1", "Comptoir Bêta")]);
    expect([...labels]).toEqual([["a1", "Négoce Alpha"], ["b1", "Comptoir Bêta"]]);
  });

  it("adds the city to homonyms in different cities, case, accents and spaces aside", () => {
    const labels = supplierPickerLabels([
      supplier("a1", "Négoce Alpha", { city: "Lyon" }),
      supplier("a2", "negoce  alpha", { city: "Grenoble" }),
    ]);
    expect(labels.get("a1")).toBe("Négoce Alpha · Lyon");
    expect(labels.get("a2")).toBe("negoce  alpha · Grenoble");
  });

  it("passes over a mark homonyms share, to the next one that tells them apart", () => {
    const labels = supplierPickerLabels([
      supplier("a1", "Best Supplier", { city: "Lyon", email: "commandes@alpha.example" }),
      supplier("a2", "Best Supplier", { city: "Lyon", email: "agence@alpha.example" }),
      supplier("a3", "Best Supplier", { siret: "00000000000018" }),
    ]);
    expect([labels.get("a1"), labels.get("a2"), labels.get("a3")]).toEqual([
      "Best Supplier · commandes@alpha.example",
      "Best Supplier · agence@alpha.example",
      "Best Supplier · SIRET 00000000000018",
    ]);
  });

  it("tells apart homonyms with nothing else by their creation, then by their identifier", () => {
    const labels = supplierPickerLabels([
      supplier("10000000-aaaa", "Best Supplier", { created_at: "2026-10-20T08:00:00.000Z" }),
      supplier("20000000-bbbb", "Best Supplier", { created_at: "2026-10-20T09:30:00.000Z" }),
      supplier("30000000-cccc", "Best Supplier", { created_at: "2026-10-21T08:00:00.000Z" }),
      supplier("40000000-dddd", "Twin", { created_at: "2026-10-22T08:00:00.000Z" }),
      supplier("50000000-eeee", "Twin", { created_at: "2026-10-22T08:00:00.000Z" }),
    ]);
    expect([...labels.values()]).toEqual([
      "Best Supplier · créé le 20/10/2026 à 10:00",
      "Best Supplier · créé le 20/10/2026 à 11:30",
      "Best Supplier · créé le 21/10/2026",
      "Twin · fiche 40000000",
      "Twin · fiche 50000000",
    ]);
  });

  it("gives every supplier its own choice, and every label once", () => {
    const suppliers = Array.from({ length: 5 }, (_, index) => supplier(`${index}0000000-0000`, "Best Supplier E2E", { city: index < 2 ? "Lyon" : null }));
    const labels = supplierPickerLabels(suppliers);
    expect(labels.size).toBe(5);
    expect(new Set(labels.values()).size).toBe(5);
  });
});
