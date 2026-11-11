import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { V3SiteCostControl, V3SiteCostDialog } from "@/components/estimates/v3/V3SiteCostControl";
import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";

// TI-541. Isolated: the refusals of the form (no cost, no supplier) write nothing, which a journey cannot
// observe; the journey SC54101 proves the saved cost, its source and the untouched catalogue.
const line = (overrides: Partial<EstimateItem> = {}) => ({ id: "line-1", title: "Tube du chantier", unit_price_ht_cents: 1000,
  k_fo: 1, fo_provision: 1.03, product_id: "product", selected_supplier_price_id: "offer", fo_price_origin: null,
  ...overrides }) as EstimateItem;
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// The row owns the open state: the menu shows the detail and the button, the dialog holds the form.
function Harness({ item, saleCoefficientFo, isReadOnly, onPatchItem, onRowGesture }: { item: EstimateItem; saleCoefficientFo: string;
  isReadOnly: boolean; onPatchItem: (...args: unknown[]) => void; onRowGesture?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={onRowGesture} onKeyDown={onRowGesture} onMouseDown={onRowGesture}>
      <V3SiteCostControl item={item} saleCoefficientFo={saleCoefficientFo} isReadOnly={isReadOnly} onEditSiteCost={() => setOpen(true)} />
      <V3SiteCostDialog item={item} open={open} isReadOnly={isReadOnly} onClose={() => setOpen(false)} onPatchItem={onPatchItem} />
    </div>
  );
}

afterEach(cleanup);

describe("TI-541 site cost control of a v3 line", () => {
  it("writes the cost, its source and the release of the catalogue offer in one patch", () => {
    const onPatchItem = vi.fn();
    render(<Harness item={line()} saleCoefficientFo="1.3000" isReadOnly={false} onPatchItem={onPatchItem} />);
    expect(screen.getByTestId("estimate-line-fo-cost-detail").textContent)
      .toBe("Offre fournisseur 10,00 € × provision FO 1,03 × K FO 1 = 10,30 € de coût FO ; × coef. de vente FO 1,3 = 13,39 €");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Saisir un coût chantier pour Tube du chantier" }));
    expect(screen.getByRole("dialog", { name: "Coût chantier" })).toBeTruthy();
    fill("Coût unitaire HT (€)", "9,50");
    fill("Fournisseur", " Négoce Fictif ");
    fill("Référence de l’offre", "OF-2611-07");
    fill("Date de l’offre", "2026-11-03");
    fireEvent.change(screen.getByLabelText("Transport"), { target: { value: "included" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le coût chantier" }));
    expect(onPatchItem).toHaveBeenCalledTimes(1);
    const [id, patch, options] = onPatchItem.mock.calls[0];
    expect([id, options]).toEqual(["line-1", { persist: true }]);
    expect(patch).toMatchObject({ unit_price_ht_cents: 950, selected_supplier_price_id: null,
      fo_price_origin: { kind: "site", transport_mode: "included",
        site: { supplier: "Négoce Fictif", offer_reference: "OF-2611-07", offer_date: "2026-11-03", document: null } } });
    expect(patch.fo_price_origin.source_id).toBe(patch.fo_price_origin.selection_id);
    expect(screen.queryByRole("form")).toBeNull();
  });
  it("writes nothing without a cost or without a supplier, and says why", () => {
    const onPatchItem = vi.fn();
    render(<Harness item={line()} saleCoefficientFo="1" isReadOnly={false} onPatchItem={onPatchItem} />);
    fireEvent.click(screen.getByRole("button", { name: "Saisir un coût chantier pour Tube du chantier" }));
    fill("Fournisseur", "Négoce Fictif");
    fill("Coût unitaire HT (€)", "0");
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByRole("alert").textContent).toBe("Saisissez le coût unitaire HT de l’offre.");
    fill("Coût unitaire HT (€)", "9");
    fill("Fournisseur", "   ");
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByRole("alert").textContent).toBe("Indiquez le fournisseur et la date de l’offre.");
    expect(onPatchItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(onPatchItem).not.toHaveBeenCalled();
  });
  it("keeps typing and clicks of the form away from the row that renders it", () => {
    const onRowGesture = vi.fn();
    render(<Harness item={line()} saleCoefficientFo="1" isReadOnly={false} onPatchItem={vi.fn()} onRowGesture={onRowGesture} />);
    fireEvent.click(screen.getByRole("button", { name: "Saisir un coût chantier pour Tube du chantier" }));
    onRowGesture.mockClear();
    const supplier = screen.getByLabelText("Fournisseur");
    fireEvent.mouseDown(supplier);
    fireEvent.click(supplier);
    fireEvent.keyDown(supplier, { key: "Delete" });
    fireEvent.keyDown(supplier, { key: "c", ctrlKey: true });
    expect(onRowGesture).not.toHaveBeenCalled();
  });
  it("shows a saved source, reopens it for editing, and offers nothing on a read-only quote", () => {
    const origin = { selection_id: "54100000-0000-4000-8000-000000000001", kind: "site", source_id: "54100000-0000-4000-8000-000000000001",
      transport_mode: "excluded", site: { supplier: "Négoce Fictif", offer_reference: null, offer_date: "2026-11-03", document: "Offre PDF" } };
    const saved = line({ unit_price_ht_cents: 900, selected_supplier_price_id: null, fo_price_origin: origin as never });
    const { rerender } = render(<Harness item={saved} saleCoefficientFo="1" isReadOnly={false} onPatchItem={vi.fn()} />);
    expect(screen.getByTestId("estimate-line-site-cost-source").textContent)
      .toBe("Source du coût chantier : Négoce Fictif · 03/11/2026 · Offre PDF");
    fireEvent.click(screen.getByRole("button", { name: "Modifier le coût chantier pour Tube du chantier" }));
    expect((screen.getByLabelText("Coût unitaire HT (€)") as HTMLInputElement).value).toBe("9,00");
    expect((screen.getByLabelText("Fournisseur") as HTMLInputElement).value).toBe("Négoce Fictif");
    expect((screen.getByLabelText("Transport") as HTMLSelectElement).value).toBe("excluded");
    rerender(<Harness item={saved} saleCoefficientFo="1" isReadOnly onPatchItem={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /coût chantier pour/, hidden: true })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });
  it("closes the form for good when the quote turns read-only, and still offers a site cost on a POSE SEULE line", () => {
    const { rerender } = render(<Harness item={line()} saleCoefficientFo="1" isReadOnly={false} onPatchItem={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Saisir un coût chantier pour Tube du chantier" }));
    fill("Fournisseur", "Négoce Fictif");
    rerender(<Harness item={line()} saleCoefficientFo="1" isReadOnly onPatchItem={vi.fn()} />);
    rerender(<Harness item={line()} saleCoefficientFo="1" isReadOnly={false} onPatchItem={vi.fn()} />);
    expect(screen.queryByRole("form")).toBeNull();
    // Réponse de Maxime du 11/11/2026 : une POSE SEULE peut porter une petite fourniture (supportage), sans provision.
    rerender(<Harness item={line({ line_nature: "pose_only", unit_price_ht_cents: 1000, fo_provision: 1, selected_supplier_price_id: null, product_id: null } as never)}
      saleCoefficientFo="1.3000" isReadOnly={false} onPatchItem={vi.fn()} />);
    expect(screen.getByTestId("estimate-line-fo-cost-detail").textContent)
      .toBe("Saisie manuelle 10,00 € × K FO 1 = 10,00 € de coût FO ; × coef. de vente FO 1,3 = 13,00 €");
    expect(screen.getByRole("button", { name: "Saisir un coût chantier pour Tube du chantier" })).toBeTruthy();
  });
});
