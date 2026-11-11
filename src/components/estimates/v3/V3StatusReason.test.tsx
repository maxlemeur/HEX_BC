import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";
import { EstimateV3GridProvider, V3LineStateControls } from "@/components/estimates/v3/V3LineCells";

// TI-682, lot C (D11, D25): the grid asks for the internal reason when a line that is, or was, « Non chiffrée » takes a
// status the client reads, and never refuses the status: it is saved first, the send waits for the reason.

afterEach(() => cleanup());

function line(overrides: Partial<EstimateItem>): EstimateItem {
  return {
    id: "line-1", item_type: "line", title: "Calorifuge des réseaux", pricing_status: "not_priced", was_not_priced: true,
    status_reason: null, tax_rate_bp: 2000, unit_code: "u",
    ...overrides,
  } as EstimateItem;
}

function renderControls(item: EstimateItem, isReadOnly = false) {
  const onPatchItem = vi.fn();
  render(
    <EstimateV3GridProvider value={{ lines: new Map(), allowedTaxRatesBp: [2000] }}>
      <V3LineStateControls item={item} isReadOnly={isReadOnly} onPatchItem={onPatchItem} />
    </EstimateV3GridProvider>
  );
  return onPatchItem;
}

const status = () => screen.getByRole("combobox", { name: "Statut de chiffrage pour Calorifuge des réseaux" });

describe("V3 internal reason of an exclusion (TI-682)", () => {
  it("saves the status first, then asks for the reason and saves it", async () => {
    const onPatchItem = renderControls(line({}));
    fireEvent.change(status(), { target: { value: "out_of_scope" } });
    expect(onPatchItem).toHaveBeenNthCalledWith(1, "line-1", { pricing_status: "out_of_scope" }, { persist: true });
    const dialog = await screen.findByTestId("estimate-v3-status-reason-dialog");
    expect(dialog).toHaveTextContent("passe en « Hors lot »");
    expect(dialog).toHaveTextContent("le client ne le lit jamais");

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le motif" }));
    expect(await screen.findByText("Choisissez un motif.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Motif" }), { target: { value: "other" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Précision/ }), { target: { value: "court" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le motif" }));
    expect(await screen.findByText(/Le motif « Autre » se précise en 10 à 500 caractères/)).toBeInTheDocument();
    expect(onPatchItem).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("textbox", { name: /Précision/ }), { target: { value: "  Lot CVC du marché  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le motif" }));
    expect(onPatchItem).toHaveBeenNthCalledWith(2, "line-1", { status_reason: { code: "other", note: "Lot CVC du marché" } },
      { persist: true });
  });

  it("lets the user answer later: the status stays saved", async () => {
    const onPatchItem = renderControls(line({}));
    fireEvent.change(status(), { target: { value: "included" } });
    fireEvent.click(await screen.findByRole("button", { name: "Plus tard" }));
    expect(onPatchItem).toHaveBeenCalledTimes(1);
    expect(onPatchItem).toHaveBeenCalledWith("line-1", { pricing_status: "included" }, { persist: true });
  });

  it("asks nothing for a line never « Non chiffrée », nor when the line already has a reason", () => {
    renderControls(line({ pricing_status: "priced", was_not_priced: false }));
    fireEvent.change(status(), { target: { value: "for_memory" } });
    expect(screen.queryByTestId("estimate-v3-status-reason-dialog")).not.toBeInTheDocument();
    cleanup();
    renderControls(line({ pricing_status: "out_of_scope", status_reason: { code: "other_trade", note: null } }));
    fireEvent.change(status(), { target: { value: "not_applicable" } });
    expect(screen.queryByTestId("estimate-v3-status-reason-dialog")).not.toBeInTheDocument();
  });

  it("marks an excluded line still without its reason, and opens it again from the line", async () => {
    renderControls(line({ pricing_status: "out_of_scope" }));
    fireEvent.click(screen.getByRole("button", { name: "Motif interne à saisir pour Calorifuge des réseaux" }));
    expect(await screen.findByTestId("estimate-v3-status-reason-dialog")).toBeInTheDocument();
    cleanup();
    renderControls(line({ pricing_status: "out_of_scope", status_reason: { code: "other_trade", note: null } }), true);
    fireEvent.click(screen.getByRole("button", { name: "Motif interne pour Calorifuge des réseaux" }));
    expect(await screen.findByTestId("estimate-v3-status-reason-dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer le motif" })).not.toBeInTheDocument();
  });
});
