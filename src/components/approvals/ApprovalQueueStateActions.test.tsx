import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/dashboard/_actions/approval-queue", () => ({
  markApprovalQueueItemStateAction: vi.fn(),
}));

import { ApprovalQueueStateActions } from "./ApprovalQueueStateActions";

afterEach(() => {
  cleanup();
});

describe("ApprovalQueueStateActions", () => {
  it("uses mobile-safe touch targets for the trigger and menu options", async () => {
    const user = userEvent.setup();
    render(
      <ApprovalQueueStateActions
        cycleId="cycle-1"
        currentState={null}
      />
    );

    const trigger = screen.getByRole("button", { name: "Actions de triage" });
    expect(trigger).toHaveClass("min-h-11", "min-w-11");

    await user.click(trigger);

    const option = screen.getByRole("option", { name: "Marquer comme vu" });
    expect(option).toHaveClass("min-h-11");
  });
});
