import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromptModal } from "@/components/ui-legacy/PromptModal";

describe("ui/PromptModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels and focuses the field, then submits a trimmed value", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(value: string) => void>();

    render(
      <PromptModal
        open
        title="Renommer le modèle"
        label="Nom du modèle"
        defaultValue="Ancien nom"
        confirmLabel="Renommer"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox", { name: "Nom du modèle" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("autocomplete", "off");

    await user.clear(input);
    await user.type(input, "  Nouveau nom  ");
    await user.click(screen.getByRole("button", { name: "Renommer" }));

    expect(onConfirm).toHaveBeenCalledWith("Nouveau nom");
  });

  it("cancels on Escape and prevents an empty submission", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <PromptModal
        open
        title="Dupliquer"
        label="Nom de la copie"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Nom de la copie" })).toHaveFocus();
    });
    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
