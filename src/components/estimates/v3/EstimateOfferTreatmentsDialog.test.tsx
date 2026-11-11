import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateOfferTreatmentsDialog } from "@/components/estimates/v3/EstimateOfferTreatmentsDialog";
import type { OfferTreatmentDraftItem } from "@/lib/estimates/offer-treatment-draft";

afterEach(() => cleanup());

const ITEMS: OfferTreatmentDraftItem[] = [
  { id: "s", parent_id: null, item_type: "section", title: "Lot plomberie" },
  { id: "nc", parent_id: "s", item_type: "line", title: "Calorifuge", pricing_status: "not_priced", source_metadata: null },
  { id: "hl", parent_id: "s", item_type: "line", title: "Percements", pricing_status: "out_of_scope", source_metadata: null },
  { id: "p", parent_id: "s", item_type: "line", title: "Réseau EU", pricing_status: "priced", source_metadata: null },
];

function renderDialog(options: { onSave?: (decisions: unknown) => Promise<void>; isReadOnly?: boolean;
  items?: OfferTreatmentDraftItem[]; limitsText?: string | null } = {}) {
  const onSave = vi.fn(options.onSave ?? (() => Promise.resolve()));
  const onClose = vi.fn();
  render(
    <EstimateOfferTreatmentsDialog isOpen items={options.items ?? ITEMS} limitsText={options.limitsText ?? null}
      isReadOnly={options.isReadOnly ?? false} projectId="project-1"
      onClose={onClose} onSave={onSave} />
  );
  return { onSave, onClose };
}

const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });

describe("EstimateOfferTreatmentsDialog", () => {
  it("saves the changed lines only, shows the sentence the client will read, and closes", async () => {
    const { onSave, onClose } = renderDialog();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/1 sans réserve : elle bloque l’envoi/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Réserve dans l’offre : Calorifuge"), { target: { value: "non chiffré, à définir." } });
    expect(screen.getByText("Réserve — « Calorifuge » : non chiffré, à définir.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("offer-treatments-basis"), { target: { value: "private_estimate" } });
    fireEvent.change(screen.getByLabelText("Motif d’exclusion : Percements"), { target: { value: "other_lot" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      { item_id: "nc", decision: { kind: "offer_reserve", basis: "private_estimate", text: "non chiffré, à définir." } },
      { item_id: "hl", decision: { kind: "internal_exclusion", reason_code: "other_lot", note: null } },
    ]);
  });

  it("asks for the basis before it sends a reserve", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByLabelText("Réserve dans l’offre : Calorifuge"), { target: { value: "à définir" } });
    fireEvent.click(saveButton());
    expect(screen.getByTestId("offer-treatments-error")).toHaveTextContent("Choisissez la base des réserves");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the window open with the refusal of the server", async () => {
    const { onClose } = renderDialog({ onSave: () => Promise.reject(new Error("Le devis a changé depuis son ouverture.")) });
    fireEvent.change(screen.getByLabelText("Motif d’exclusion : Percements"), { target: { value: "client_supplied" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("offer-treatments-error")).toHaveTextContent("Le devis a changé depuis son ouverture."));
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("adds a reserve to a priced line the estimator picks", () => {
    renderDialog();
    expect(screen.queryByLabelText("Réserve dans l’offre : Réseau EU")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ajouter une réserve à une ligne chiffrée"), { target: { value: "p" } });
    expect(screen.getByLabelText("Réserve dans l’offre : Réseau EU")).toBeInTheDocument();
  });

  it("offers to write again a reserve whose sentence has left the offer text", async () => {
    const items: OfferTreatmentDraftItem[] = [ITEMS[0], { ...ITEMS[1], source_metadata: { offer_treatment: {
      version: 1, kind: "offer_reserve", basis: "private_estimate", text: "à définir",
      sentence: "Réserve — « Calorifuge » : à définir", decided_by: "11111111-1111-4111-8111-111111111111",
      decided_at: "2026-11-11T10:00:00.000Z" } } }];
    const { onSave } = renderDialog({ items, limitsText: "Hors peinture." });
    expect(screen.getByText(/n’est plus dans le texte de l’offre/u)).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { item_id: "nc", decision: { kind: "offer_reserve", basis: "private_estimate", text: "à définir" } },
    ]));
  });

  it("shows a read-only version without a way to save", () => {
    renderDialog({ isReadOnly: true });
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Réserve dans l’offre : Calorifuge")).toBeDisabled();
    expect(screen.getByTestId("offer-treatments-basis")).toBeDisabled();
  });
});
