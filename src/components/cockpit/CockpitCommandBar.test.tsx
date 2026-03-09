import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CockpitCommandBar } from "@/components/cockpit/CockpitCommandBar";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

function makeSuggestion(
  actionId: string,
  label: string,
): CockpitSuggestion {
  return {
    actionId,
    label,
    intent: "analyze_plans",
    preview: `${label} preview`,
    target: { kind: "open_dialog", dialogId: `${actionId}-dialog` },
    requiresConfirmation: false,
    confirmTone: "info",
  };
}

describe("CockpitCommandBar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("executes overflow suggestions from the +N menu", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const onOpenDialog = vi.fn();

    render(
      <CockpitCommandBar
        suggestions={[
          makeSuggestion("action-1", "Action 1"),
          makeSuggestion("action-2", "Action 2"),
          makeSuggestion("action-3", "Action 3"),
          makeSuggestion("action-4", "Preparer la validation"),
        ]}
        projectId="11111111-1111-1111-1111-111111111111"
        onExecute={onExecute}
        onOpenDialog={onOpenDialog}
      />
    );

    await user.click(screen.getByRole("button", { name: "+1 autre" }));
    await user.click(screen.getByRole("button", { name: "Preparer la validation" }));

    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: "action-4" }),
    );
    expect(onOpenDialog).toHaveBeenCalledWith("action-4-dialog");
  });
});
