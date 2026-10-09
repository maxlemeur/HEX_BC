import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { MarginTiersManager } from "@/components/estimates/MarginTiersManager";

type Tier = ComponentProps<typeof MarginTiersManager>["tiers"][number];
const tiers: Tier[] = [
  { id: "tier-0", tenant_id: "tenant-1", threshold_cents: 0, multiplier: 1.2, position: 0 },
  { id: "tier-1", tenant_id: "tenant-1", threshold_cents: 100_000, multiplier: 1.1, position: 1 },
] as Tier[];

function setup(canEdit = true) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(<MarginTiersManager tiers={tiers} isSaving={false} error={null} canEdit={canEdit} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} />);
  return { onCreate, onUpdate, onDelete };
}

afterEach(cleanup);

describe("margin tier configuration", () => {
  it("validates empty fields and duplicate thresholds before writing", () => {
    const callbacks = setup();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Le seuil doit être");
    fireEvent.change(screen.getByLabelText("Seuil de coût HT (EUR)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Le coefficient doit être renseigné");
    fireEvent.change(screen.getByLabelText("Coefficient"), { target: { value: "1.4" } });
    fireEvent.change(screen.getByLabelText("Seuil de coût HT (EUR)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ce seuil existe déjà");
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });

  it("sends a valid new tier and clears only its creation fields", async () => {
    const callbacks = setup();
    fireEvent.change(screen.getByLabelText("Seuil de coût HT (EUR)"), { target: { value: "2000.50" } });
    fireEvent.change(screen.getByLabelText("Coefficient"), { target: { value: "1.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith({ threshold_cents: 200_050, multiplier: 1.4 }));
    await waitFor(() => expect(screen.getByLabelText("Coefficient")).toHaveValue(null));
    expect(screen.getByLabelText("Coefficient de la tranche 0.00 EUR")).toHaveValue(1.2);
  });

  it("does not save duplicate or blank edits on blur", () => {
    const callbacks = setup();
    const threshold = screen.getByLabelText("Seuil de coût HT de la tranche 1000.00 EUR");
    fireEvent.change(threshold, { target: { value: "0" } });
    fireEvent.blur(threshold);
    expect(screen.getByRole("alert")).toHaveTextContent("ce seuil existe déjà");
    fireEvent.change(threshold, { target: { value: "" } });
    fireEvent.blur(threshold);
    expect(screen.getByRole("alert")).toHaveTextContent("Le seuil doit être");
    expect(callbacks.onUpdate).not.toHaveBeenCalled();
  });

  it("keeps the barème readable without editing permissions", () => {
    const callbacks = setup(false);
    expect(screen.getByText(/Consultation seule/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Supprimer/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Coefficient de la tranche 0.00 EUR")).toBeDisabled();
    expect(callbacks.onCreate).not.toHaveBeenCalled();
    expect(callbacks.onUpdate).not.toHaveBeenCalled();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });
});
