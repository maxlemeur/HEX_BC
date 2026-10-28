import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/client", () => ({ reconcileProjectPlanDossier: vi.fn() }));
import { reconcileProjectPlanDossier } from "@/lib/takeoff/client";
import { PlanDossierSyncNotice } from "./PlanDossierSyncNotice";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PlanDossierSyncNotice", () => {
  it("offers a retry after a failed automatic reconciliation", async () => {
    vi.mocked(reconcileProjectPlanDossier).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const onSynchronized = vi.fn();
    const user = userEvent.setup();
    render(<PlanDossierSyncNotice projectId="project" automatic onSynchronized={onSynchronized} />);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(onSynchronized).toHaveBeenCalledWith(true);
  });
});
