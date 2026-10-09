import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffLineEvidencePanel: vi.fn(),
  isTakeoffApiError: (error: unknown) =>
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    "message" in error,
}));

import { TakeoffLineEvidencePanel } from "@/components/takeoff/TakeoffLineEvidencePanel";
import { fetchTakeoffLineEvidencePanel } from "@/lib/takeoff/client";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const LINE_ID = "33333333-3333-4333-8333-333333333333";

describe("TakeoffLineEvidencePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the API error message and retries on demand", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchTakeoffLineEvidencePanel)
      .mockRejectedValueOnce({
        status: 409,
        message: "Version introuvable pour cette ligne.",
      })
      .mockResolvedValueOnce({
        line_id: LINE_ID,
        version_id: VERSION_ID,
        job_id: JOB_ID,
        evidences: [],
        history: [],
      });

    render(
      <TakeoffLineEvidencePanel
        open
        onOpenChange={vi.fn()}
        jobId={JOB_ID}
        versionId={VERSION_ID}
        lineId={LINE_ID}
        lineLabel="Peinture facade"
      />
    );

    expect(
      await screen.findByText("Version introuvable pour cette ligne.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actualiser" }));

    await waitFor(() => {
      expect(fetchTakeoffLineEvidencePanel).toHaveBeenCalledTimes(2);
    });

    expect(
      await screen.findByText("Aucune preuve detaillee n'est disponible pour cette ligne.")
    ).toBeInTheDocument();
  });
});
