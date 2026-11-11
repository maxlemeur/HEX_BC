import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import type { EstimateSendGatingFlag } from "@/lib/estimates/client";

afterEach(() => cleanup());

function flag(key: string, label: string): EstimateSendGatingFlag {
  return { key, severity: "blocking", count: 1, itemIds: ["line-1"], label, description: label };
}

function renderDialog(blockingFlags: EstimateSendGatingFlag[]) {
  render(
    <EstimateSendGatingDialog
      isOpen
      isSubmitting={false}
      phaseLabel={null}
      blockingFlags={blockingFlags}
      warningFlags={[]}
      canForce
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onForceConfirm={vi.fn()}
    />
  );
}

describe("EstimateSendGatingDialog", () => {
  it("offers an administrator the override for ordinary blockers", () => {
    renderDialog([flag("missing_price", "Prix manquant")]);
    expect(screen.getByRole("button", { name: "Forcer l'envoi" })).toBeInTheDocument();
  });

  // TI-682 (D25): a « Non chiffrée » line is classified before sending; no override is offered while one remains.
  it("withholds the override while a « Non chiffrée » line is still to classify", () => {
    renderDialog([flag("missing_price", "Prix manquant"), flag("not_priced_unclassified", "Lignes non chiffrées à classer")]);
    expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
    expect(screen.getByText(/Les lignes non chiffrées se classent avant l'envoi/)).toBeInTheDocument();
  });
  // TI-682, lot C (D25): an excluded necessary service says why before it leaves. The send window lists the lines and
  // takes the reason on the spot; no override is offered while one remains.
  describe("lines excluded without an internal reason", () => {
    const reasonFlag: EstimateSendGatingFlag = {
      key: "excluded_without_reason", severity: "blocking", count: 1, itemIds: ["line-1"],
      label: "Motif interne d'exclusion à saisir", description: "À justifier",
    };
    function renderReasonDialog(onSaveStatusReason = vi.fn(async () => true)) {
      render(
        <EstimateSendGatingDialog
          isOpen
          isSubmitting={false}
          phaseLabel={null}
          blockingFlags={[flag("missing_price", "Prix manquant"), reasonFlag]}
          warningFlags={[]}
          canForce
          statusReasonLines={[{ id: "line-1", title: "Calorifuge des réseaux", statusLabel: "Hors lot" }]}
          onSaveStatusReason={onSaveStatusReason}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          onForceConfirm={vi.fn()}
        />
      );
      return onSaveStatusReason;
    }

    it("withholds the override and names each line by its title and status", () => {
      renderReasonDialog();
      expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
      expect(screen.getByText(/Les lignes exclues après « Non chiffrée » se justifient avant l'envoi/)).toBeInTheDocument();
      expect(screen.getByText("Calorifuge des réseaux")).toBeInTheDocument();
      expect(screen.getByText("Hors lot")).toBeInTheDocument();
      expect(screen.getByText(/jamais transmis au client/)).toBeInTheDocument();
    });

    it("saves the reason entered on the spot, and refuses a note the database would refuse", async () => {
      const save = renderReasonDialog();
      const code = screen.getByRole("combobox", { name: "Motif interne pour Calorifuge des réseaux" });
      const note = screen.getByRole("textbox", { name: "Précision du motif pour Calorifuge des réseaux" });
      const submit = screen.getByRole("button", { name: "Enregistrer le motif de Calorifuge des réseaux" });

      fireEvent.change(code, { target: { value: "other" } });
      fireEvent.change(note, { target: { value: "court" } });
      fireEvent.click(submit);
      expect(await screen.findByText(/Le motif « Autre » se précise en 10 à 500 caractères/)).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();

      fireEvent.change(code, { target: { value: "client_supplied" } });
      fireEvent.change(note, { target: { value: "  Fourni par le maître d'ouvrage  " } });
      fireEvent.click(submit);
      await waitFor(() => expect(save).toHaveBeenCalledWith("line-1", {
        code: "client_supplied", note: "Fourni par le maître d'ouvrage",
      }));
    });

    it("offers no entry to a reader who cannot write the line", () => {
      render(
        <EstimateSendGatingDialog
          isOpen
          isSubmitting={false}
          phaseLabel={null}
          blockingFlags={[reasonFlag]}
          warningFlags={[]}
          canForce={false}
          statusReasonLines={[{ id: "line-1", title: "Calorifuge des réseaux", statusLabel: "Hors lot" }]}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          onForceConfirm={vi.fn()}
        />
      );
      expect(screen.getByText("Calorifuge des réseaux")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Enregistrer le motif/ })).not.toBeInTheDocument();
    });
  });
});
