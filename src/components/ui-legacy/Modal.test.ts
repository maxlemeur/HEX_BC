import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Modal } from "@/components/ui-legacy/Modal";

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

  it("keeps scroll locked during overlapping dialogs and releases it after out-of-order close", () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";
    const pair = (first: boolean, second: boolean) => createElement(
      "div",
      null,
      createElement(TestModal, { open: first }),
      createElement(TestModal, { open: second }),
    );
    const view = render(pair(true, false));
    const backgroundRoot = view.container;
    expect(document.body.style.overflow).toBe("hidden");
    view.rerender(pair(true, true));
    view.rerender(pair(false, true));
    expect(document.body.style.overflow).toBe("hidden");
    expect(backgroundRoot).toHaveProperty("inert", true);
    view.rerender(pair(false, false));
    expect(document.body.style.overflow).toBe("auto");
    expect(backgroundRoot).not.toHaveProperty("inert", true);
    expect(backgroundRoot).not.toHaveAttribute("aria-hidden");
    document.body.style.overflow = previousOverflow;
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
      const backgroundRoot = screen.getByTestId("stacking-context").parentElement;
      expect(backgroundRoot).not.toHaveAttribute(
        "aria-hidden"
      );
      expect(backgroundRoot).toHaveProperty(
        "inert",
        false
      );
    });
  });
});
