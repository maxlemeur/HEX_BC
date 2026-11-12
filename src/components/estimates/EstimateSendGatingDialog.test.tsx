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
    // TI-682, lot C, PR 4: the honest way out is named.
    expect(screen.getByText(/un administrateur déclare la réserve sur la ligne/)).toBeInTheDocument();
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

  // TI-682, lot C, PR 4 (D10, D28): the written reserve. The issuer sees each reserve and its basis; a reserve with empty
  // limits is written, never forced.
  describe("written reserves", () => {
    const reserveLines = [
      { id: "line-1", title: "Réseau enterré", description: "Devis privé (hors marché public) — À chiffrer après relevé" },
      { id: "line-2", title: "Calorifuge", description: "Quantités indicatives selon le règlement de la consultation — "
        + "Question posée à l'acheteur : RC article 5.2" },
    ];
    const declared: EstimateSendGatingFlag = { key: "offer_reserve_declared", severity: "warning", count: 2,
      itemIds: ["line-1", "line-2"], label: "Réserves écrites dans l'offre", description: "Vérifiez la base de chaque réserve." };
    const limits: EstimateSendGatingFlag = { key: "offer_limits_required", severity: "blocking", count: 2,
      itemIds: ["line-1", "line-2"], label: "Précisions et limites de prestation à rédiger", description: "À rédiger" };
    function renderReserveDialog(blocking: EstimateSendGatingFlag[], onOpenLimits?: () => void) {
      const onConfirm = vi.fn();
      render(
        <EstimateSendGatingDialog
          isOpen
          isSubmitting={false}
          phaseLabel={null}
          blockingFlags={blocking}
          warningFlags={[declared]}
          canForce
          reserveLines={reserveLines}
          onOpenLimits={onOpenLimits}
          onClose={vi.fn()}
          onConfirm={onConfirm}
          onForceConfirm={vi.fn()}
        />
      );
      return onConfirm;
    }

    it("lists each reserved line with its basis and reason, and lets the offer leave once the limits are written", () => {
      const onConfirm = renderReserveDialog([]);
      expect(screen.getByText("Réseau enterré")).toBeInTheDocument();
      expect(screen.getByText("Devis privé (hors marché public) — À chiffrer après relevé")).toBeInTheDocument();
      expect(screen.getByText(/RC article 5\.2/)).toBeInTheDocument();
      expect(screen.getByText(/En marché public à prix global et forfaitaire, une réserve peut rendre l'offre irrégulière/))
        .toBeInTheDocument();
      expect(screen.queryByText(/line-1/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
      expect(onConfirm).toHaveBeenCalled();
    });

    it("withholds the override while the limits are empty, and opens them to write on request", () => {
      const open = vi.fn();
      renderReserveDialog([flag("missing_price", "Prix manquant"), limits], open);
      expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
      expect(screen.getByText(/le forçage n'est pas proposé tant que les précisions sont vides/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Rédiger les précisions" }));
      expect(open).toHaveBeenCalledTimes(1);
    });

    it("offers no writing to a reader who cannot write the limits", () => {
      renderReserveDialog([limits]);
      expect(screen.queryByRole("button", { name: "Rédiger les précisions" })).not.toBeInTheDocument();
    });
  });

  // TI-682, lot C, PR 5: a provisional quantity leaves only with its sentence in the limits text. When that text can no
  // longer receive the missing sentences, the window says how many characters are missing and what actually unblocks.
  describe("provisional quantities", () => {
    const missing = (details?: Record<string, unknown>): EstimateSendGatingFlag => ({
      key: "provisional_quantity_mention_missing", severity: "blocking", count: 1, itemIds: ["line-1"],
      label: "Mention « quantité provisionnelle » à écrire", description: "À écrire", ...(details ? { details } : {}) });
    const lines = [{ id: "line-1", title: "Calorifuge", description: "Calorifuge : quantité provisionnelle de 12 ml, établie "
      + "sur le plan CVC, à confirmer selon le relevé." }];
    function renderProvisional(flagValue: EstimateSendGatingFlag) {
      render(
        <EstimateSendGatingDialog
          isOpen
          isSubmitting={false}
          phaseLabel={null}
          blockingFlags={[flagValue]}
          warningFlags={[]}
          canForce
          reserveLines={lines}
          onOpenLimits={vi.fn()}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          onForceConfirm={vi.fn()}
        />
      );
    }

    it("lists the sentence each line asks, without override", () => {
      renderProvisional(missing());
      expect(screen.getByText(/quantité provisionnelle de 12 ml/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("estimate-send-gating-provisional-overflow")).not.toBeInTheDocument();
    });

    it("says how many characters the limits text lacks and what unblocks the offer", () => {
      renderProvisional(missing({ limits_overflow: { missing_characters: 572, limit: 5000 } }));
      const message = screen.getByTestId("estimate-send-gating-provisional-overflow");
      expect(message).toHaveTextContent("il manque 572 caractères sur 5000.");
      expect(message).toHaveTextContent("raccourcissez « Établie sur » et « À confirmer selon »");
      expect(message).toHaveTextContent("allégez le reste des précisions");
      expect(message).toHaveTextContent("retirez la déclaration des lignes dont la phrase manque");
      expect(screen.queryByRole("button", { name: "Forcer l'envoi" })).not.toBeInTheDocument();
    });
  });
});
