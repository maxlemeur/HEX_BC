import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";
import { EstimateV3GridProvider, V3LineStateControls } from "@/components/estimates/v3/V3LineCells";

// TI-682, lot C, PR 4 (D10, D28): an administrator declares, on a « Non chiffrée » line, the written reserve the offer
// leaves with. The warning is shown when the choice is made; the basis is declared, never verified. Anyone else reads
// whether a line is reserved, and cannot change it.

afterEach(() => cleanup());

const RESERVE = { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: null,
  decided_by: "11111111-1111-4111-8111-111111111111", decided_at: "2026-11-11T18:02:23.123456+00:00" };

function line(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: "line-1", item_type: "line", title: "Réseau enterré", pricing_status: "not_priced", was_not_priced: true,
    status_reason: null, offer_choice: null, tax_rate_bp: 2000, unit_code: "u",
    ...overrides,
  } as EstimateItem;
}

function renderControls(item: EstimateItem, options: { canDeclare: boolean; isReadOnly?: boolean } = { canDeclare: true }) {
  const save = vi.fn(async () => undefined);
  render(
    <EstimateV3GridProvider value={{ lines: new Map(), allowedTaxRatesBp: [2000],
      offerReserve: { canDeclare: options.canDeclare, save } }}>
      <V3LineStateControls item={item} isReadOnly={options.isReadOnly ?? false} onPatchItem={vi.fn()} />
    </EstimateV3GridProvider>
  );
  return save;
}

describe("V3 written reserve in the offer (TI-682)", () => {
  it("lets an administrator declare the reserve of a « Non chiffrée » line, with the warning and its basis", async () => {
    const save = renderControls(line());
    fireEvent.click(screen.getByRole("button", { name: "Déclarer une réserve pour Réseau enterré" }));
    const dialog = await screen.findByTestId("estimate-v3-offer-reserve-dialog");
    expect(dialog).toHaveTextContent("une réserve peut rendre l'offre irrégulière");
    expect(dialog).toHaveTextContent("« Non chiffrée »");

    fireEvent.click(screen.getByRole("button", { name: "Déclarer la réserve" }));
    expect(await screen.findByText("Choisissez la base et le motif de la réserve.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Quantités indicatives/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Motif" }), { target: { value: "pending_buyer_answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Déclarer la réserve" }));
    expect(await screen.findByText(/référence de l'article du règlement de la consultation/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /Précision/ }), { target: { value: "  RC article 5.2 : quantités indicatives " } });
    fireEvent.click(screen.getByRole("button", { name: "Déclarer la réserve" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("line-1", {
      kind: "reserve", basis: "indicative_quantities", code: "pending_buyer_answer", note: "RC article 5.2 : quantités indicatives",
    }));
  });

  it("shows a declared reserve on the line, and lets the administrator withdraw it", async () => {
    const save = renderControls(line({ offer_choice: RESERVE as never }));
    fireEvent.click(screen.getByRole("button", { name: "Réserve déclarée pour Réseau enterré" }));
    await screen.findByTestId("estimate-v3-offer-reserve-dialog");
    expect(screen.getByRole("radio", { name: /Devis privé/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Retirer la réserve" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("line-1", null));
  });

  it("offers no declaration to a non-administrator, nor on a line that is not « Non chiffrée », nor read-only", () => {
    renderControls(line(), { canDeclare: false });
    expect(screen.queryByRole("button", { name: /réserve/i })).not.toBeInTheDocument();
    cleanup();
    renderControls(line({ pricing_status: "priced" }));
    expect(screen.queryByRole("button", { name: /réserve/i })).not.toBeInTheDocument();
    cleanup();
    renderControls(line(), { canDeclare: true, isReadOnly: true });
    expect(screen.queryByRole("button", { name: /réserve/i })).not.toBeInTheDocument();
  });

  it("tells a non-administrator that a line is reserved, without letting them change it", async () => {
    const save = renderControls(line({ offer_choice: RESERVE as never }), { canDeclare: false });
    fireEvent.click(screen.getByRole("button", { name: "Réserve déclarée pour Réseau enterré" }));
    await screen.findByTestId("estimate-v3-offer-reserve-dialog");
    expect(screen.queryByRole("button", { name: "Retirer la réserve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Déclarer la réserve" })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
