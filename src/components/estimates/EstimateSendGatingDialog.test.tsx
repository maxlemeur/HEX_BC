import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";

describe("EstimateSendGatingDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps clarify-with-client register links focusable for non-critical entries", () => {
    render(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting={false}
        phaseLabel={null}
        canForce
        projectId="project-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onForceConfirm={vi.fn()}
        blockingFlags={[
          {
            key: "client_clarification_required",
            category: "register",
            severity: "blocking",
            count: 1,
            itemIds: [],
            label: "Clarification client requise",
            description: "Une clarification client reste ouverte.",
            details: {
              register_entries: [
                {
                  kind: "assumption",
                  scopeLabel: "Lot CFO",
                  text: "Valider la variante",
                  href: "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=5bc9244d-cf64-4d86-bf86-f5d9d2f203d6",
                },
              ],
            },
          },
        ]}
        warningFlags={[]}
      />
    );

    expect(
      screen.queryByRole("link", { name: "Ouvrir le registre affaire" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Registre: Lot CFO: Valider la variante" })
    ).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=5bc9244d-cf64-4d86-bf86-f5d9d2f203d6"
    );
  });

  it("moves focus inside, traps keyboard navigation, and restores prior focus", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.textContent = "Ouvrir la verification";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const onForceConfirm = vi.fn();
    const { rerender } = render(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting={false}
        phaseLabel={null}
        canForce={false}
        onClose={onClose}
        onConfirm={onConfirm}
        onForceConfirm={onForceConfirm}
        blockingFlags={[]}
        warningFlags={[]}
      />
    );

    const closeButton = screen.getByRole("button", { name: "Fermer" });
    const sendButton = screen.getByRole("button", { name: "Envoyer" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    sendButton.focus();
    await user.tab();
    await waitFor(() => expect(closeButton).toHaveFocus());

    closeButton.focus();
    await user.tab({ shift: true });
    await waitFor(() => expect(sendButton).toHaveFocus());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onForceConfirm).not.toHaveBeenCalled();

    rerender(
      <EstimateSendGatingDialog
        isOpen={false}
        isSubmitting={false}
        phaseLabel={null}
        canForce={false}
        onClose={onClose}
        onConfirm={onConfirm}
        onForceConfirm={onForceConfirm}
        blockingFlags={[]}
        warningFlags={[]}
      />
    );

    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("closes on Escape only when no submission is in progress", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const onForceConfirm = vi.fn();
    const { rerender } = render(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting={false}
        phaseLabel={null}
        canForce
        onClose={onClose}
        onConfirm={onConfirm}
        onForceConfirm={onForceConfirm}
        blockingFlags={[]}
        warningFlags={[]}
      />
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onForceConfirm).not.toHaveBeenCalled();

    onClose.mockClear();
    rerender(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting
        phaseLabel="Envoi en cours"
        canForce
        onClose={onClose}
        onConfirm={onConfirm}
        onForceConfirm={onForceConfirm}
        blockingFlags={[]}
        warningFlags={[]}
      />
    );

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onForceConfirm).not.toHaveBeenCalled();
  });
});
