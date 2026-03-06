import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders active evidence and history from the dedicated endpoint", async () => {
    vi.mocked(fetchTakeoffLineEvidencePanel).mockResolvedValue({
      line_id: LINE_ID,
      version_id: VERSION_ID,
      job_id: JOB_ID,
      evidences: [
        {
          evidence_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          type: "takeoff",
          kind: "fact",
          label: "Peinture",
          source: "Plan facade",
          source_file_name: "plan.pdf",
          source_page: 8,
          confidence_score: 0.82,
          note: "Mesure facade sud",
          created_at: "2026-03-06T18:00:00.000Z",
          author_name: "Maxime Michel",
          status: "active",
          supersedes_evidence_id: null,
          replaced_by_evidence_id: null,
        },
      ],
      history: [
        {
          evidence_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          type: "comment",
          kind: "inference",
          label: "Arbitrage de revue",
          source: "Decision de revue humaine",
          source_file_name: null,
          source_page: null,
          confidence_score: null,
          note: "Ancienne justification remplacee",
          created_at: "2026-03-05T18:00:00.000Z",
          author_name: "Direction Hydro Express",
          status: "replaced",
          supersedes_evidence_id: null,
          replaced_by_evidence_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
      ],
    });

    render(
      <TakeoffLineEvidencePanel
        open
        onOpenChange={vi.fn()}
        jobId={JOB_ID}
        versionId={VERSION_ID}
        lineId={LINE_ID}
        lineLabel="Peinture facade"
        sourceFileName="dpgf.xlsx"
        sourcePage={12}
      />
    );

    await waitFor(() => {
      expect(fetchTakeoffLineEvidencePanel).toHaveBeenCalledWith(
        JOB_ID,
        LINE_ID,
        { version_id: VERSION_ID },
        expect.any(Object)
      );
    });

    expect(await screen.findByText("Peinture facade")).toBeInTheDocument();
    expect(screen.getByText("dpgf.xlsx · ligne 12")).toBeInTheDocument();
    expect(screen.getByText("Preuves actives")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Historique",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Mesure facade sud")).toBeInTheDocument();
    expect(screen.getByText("Ancienne justification remplacee")).toBeInTheDocument();
    expect(screen.getByText("Remplacee")).toBeInTheDocument();
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

  it("uses page wording for pdf sources in the panel header", async () => {
    vi.mocked(fetchTakeoffLineEvidencePanel).mockResolvedValue({
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
        sourceFileName="plans.pdf"
        sourcePage={8}
      />
    );

    expect(await screen.findByText("plans.pdf · page 8")).toBeInTheDocument();
  });
});
