import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

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
    target: { kind: "open_surface", surfaceId: "launch-metre" },
    requiresConfirmation: false,
    confirmTone: "info",
    priority: 100,
    isPinned: false,
    isHidden: false,
  };
}

describe("CockpitCommandBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the manage panel even when every action is hidden", async () => {
    const user = userEvent.setup();

    render(
      <CockpitCommandBar
        suggestions={[
          {
            ...makeSuggestion("action-1", "Action 1"),
            isHidden: true,
          },
        ]}
        onExecute={vi.fn()}
        onToggleHidden={vi.fn()}
        onTogglePinned={vi.fn()}
      />,
    );

    expect(screen.getByText("Toutes les actions sont masquees.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Gérer" }));

    expect(screen.getByText("Action 1")).toBeInTheDocument();
  });
});
