import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui/Modal";

function TestModal({
  open = true,
  onOpenChange = () => undefined,
}: Readonly<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>) {
  return createElement(
    "div",
    { "data-testid": "stacking-context" },
    createElement(
      Modal.Root,
      { open, onOpenChange } as never,
      createElement(
        Modal.Content,
        null,
        createElement(Modal.Title, null, "Produit"),
        createElement(
          Modal.Body,
          null,
          createElement("input", { "aria-label": "Référence" }),
          createElement("button", { type: "button" }, "Enregistrer")
        )
      )
    )
  );
}

function ControlledModal() {
  const [open, setOpen] = useState(false);

  return createElement(
    "div",
    { "data-testid": "stacking-context" },
    createElement(
      "button",
      { type: "button", onClick: () => setOpen(true) },
      "Ajouter un produit"
    ),
    createElement(
      Modal.Root,
      { open, onOpenChange: setOpen } as never,
      createElement(
        Modal.Content,
        null,
        createElement(Modal.Title, null, "Produit"),
        createElement(
          Modal.Body,
          null,
          createElement("input", { "aria-label": "Référence" }),
          createElement(Modal.Close, null, "Fermer")
        )
      )
    )
  );
}

describe("ui/Modal", () => {
  afterEach(() => {
    cleanup();
  });

  it("portals the dialog into document.body above page stacking contexts", () => {
    render(createElement(TestModal));

    const dialog = screen.getByRole("dialog", { name: "Produit" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body).toContainElement(dialog);
    expect(screen.getByTestId("stacking-context")).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toHaveClass("z-[100]");
  });

  it("closes on overlay click", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();

    render(createElement(TestModal, { onOpenChange }));

    await user.pointer({
      target: document.querySelector<HTMLElement>("[data-ui-modal-overlay='true']")!,
      keys: "[MouseLeft]",
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();

    render(createElement(TestModal, { onOpenChange }));

    await waitFor(() => expect(screen.getByLabelText("Référence")).toHaveFocus());
    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("focuses the first control and traps Tab navigation inside the dialog", async () => {
    const user = userEvent.setup();

    render(createElement(TestModal));

    const firstControl = screen.getByLabelText("Référence");
    const lastControl = screen.getByRole("button", { name: "Enregistrer" });

    await waitFor(() => expect(firstControl).toHaveFocus());

    await user.tab({ shift: true });
    expect(lastControl).toHaveFocus();

    await user.tab();
    expect(firstControl).toHaveFocus();
  });

  it("restores focus to the trigger when the modal closes", async () => {
    const user = userEvent.setup();

    render(createElement(ControlledModal));

    const trigger = screen.getByRole("button", { name: "Ajouter un produit" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("Référence")).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Fermer" }));

    await waitFor(() => {
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
