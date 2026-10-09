import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

import { ConfirmModal } from "@/components/ui-legacy/ConfirmModal";

describe("ui/ConfirmModal", () => {
  afterEach(() => {
    cleanup();
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
