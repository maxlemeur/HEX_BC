import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

describe("ui/ConfirmModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shared dialog semantics and confirms explicitly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmModal
        open
        title="Supprimer l’affaire"
        message="Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Supprimer l’affaire" });
    expect(dialog).toHaveAccessibleDescription("Cette action est irréversible.");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Annuler" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape when cancellation is available", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmModal
        open
        title="Archiver"
        message="Confirmez l’archivage."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Annuler" })).toHaveFocus();
    });
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending confirmation locked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmModal
        open
        title="Suppression en cours"
        message="Patientez pendant la suppression."
        cancelDisabled
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.keyboard("{Escape}");
    await user.pointer({
      target: document.querySelector<HTMLElement>("[data-ui-modal-overlay='true']")!,
      keys: "[MouseLeft]",
    });

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
