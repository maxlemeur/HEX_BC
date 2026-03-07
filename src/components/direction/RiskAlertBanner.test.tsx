import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

const mockUpdateDirectionAlertStatusAction = vi.fn();
vi.mock("@/app/dashboard/_actions/direction", () => ({
  updateDirectionAlertStatusAction: (...args: unknown[]) =>
    mockUpdateDirectionAlertStatusAction(...args),
}));

import { RiskAlertBanner } from "@/components/direction/RiskAlertBanner";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";

const ALERT: DirectionSyntheticAlert = {
  alertKey: "project-1:version-1:generic",
  projectId: "project-1",
  projectName: "Affaire alpha",
  versionId: "version-1",
  jobId: "job-1",
  latestJobId: "job-1",
  level: "warning",
  label: "Marge fragile avec ecarts ouverts",
  reasons: ["3 exceptions restent a arbitrer."],
  status: "to_process",
  alertIds: ["alert-1"],
  lotLabels: [],
};

describe("RiskAlertBanner", () => {
  it("moves focus to the note field and restores it to the trigger on cancel", async () => {
    const user = userEvent.setup();
    render(<RiskAlertBanner alerts={[ALERT]} />);

    const trigger = screen.getByRole("button", { name: "Marquer assumee" });
    await user.click(trigger);

    const noteField = screen.getByLabelText("Note de decision");
    expect(noteField).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /Confirmer l'hypothese/i })
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByLabelText("Note de decision")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marquer assumee" })).toHaveFocus();
  });
});
