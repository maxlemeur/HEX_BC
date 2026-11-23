import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RevisionPanel } from "./RevisionPanel";
import { requestContributionRevision } from "@/lib/takeoff/client";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import type { RevisionVersion, RevisionPreview } from "@/lib/takeoff/contribution-revision-contracts";

vi.mock("@/lib/takeoff/client", () => ({ requestContributionRevision: vi.fn() }));
vi.mock("@/lib/takeoff/apply-draft-lock", () => ({
  ensureTakeoffApplyDraftLock: async () => ({ acquired: true, shouldRelease: false }),
}));

const version: RevisionVersion = {
  version_id: "v",
  job_id: "job",
  receipt_id: "sent",
  version_number: 1,
  status: "draft",
  editable: true,
  items: [
    {
      item_id: "basin",
      answer_id: "answer",
      answer_revision: "hash",
      work_revision: 0,
      current: true,
      sent: [],
      correction: null,
      sources: {
        reference: null,
        anomaly: false,
        mixed_units: false,
        marks_revision: 2,
        plan_entry_revision: null,
        unit: "u",
        measured: 2,
        measured_unit: "u",
        whole_entry: false,
        entry: null,
        verified: null,
      },
    },
  ],
};
const changes: RevisionPreview["changes"] = [
  {
    item_id: "basin",
    answer_id: "answer",
    action: "replace",
    label: "Lavabo",
    before_parts: [],
    parts: [],
    quantity: 2,
    source: "measured",
    ready: true,
    marks_revision: 2,
  },
];
const bare: RevisionPreview = {
  currency: "EUR",
  digest: "first",
  actions: [],
  additions: [],
  left_out: [],
  changes,
  blockers: [
    { reason: "typed_line", item_id: "basin", line_id: "line", title: "Lavabo", entered: 7, retained: 2 },
  ],
};
const resolved: RevisionPreview = { ...bare, digest: "seen", blockers: [] };

it("explains a stale preview and presents the still applicable line choice on the new digest for another confirmation", async () => {
  const call = vi.mocked(requestContributionRevision);
  call
    .mockResolvedValueOnce({ action: "preview", preview: bare })
    .mockResolvedValueOnce({ action: "preview", preview: resolved })
    .mockRejectedValueOnce(
      new TakeoffApiError("Le devis a changé.", 409, { reason: "TAKEOFF_REVISION_STALE" }, null),
    )
    .mockResolvedValueOnce({ action: "preview", preview: bare })
    .mockResolvedValueOnce({ action: "preview", preview: { ...resolved, digest: "fresh" } });
  render(
    <RevisionPanel
      version={version}
      item={version.items[0]}
      viewer="actor"
      planId="plan"
      editable
      measuredAnswer
      onItem={() => {}}
      refresh={async () => version}
      onRefused={() => false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la correction" }));
  fireEvent.click(await screen.findByRole("button", { name: "Conserver la saisie (7)" }));
  await screen.findByRole("button", { name: "Revoir les choix sur les lignes et les pages" });
  fireEvent.click(screen.getByRole("button", { name: "Confirmer la correction" }));
  expect(await screen.findByText(/Le devis a changé.*choix encore applicables/)).toBeVisible();
  expect(call).toHaveBeenLastCalledWith(
    "job",
    expect.objectContaining({ action: "preview", choices: { lines: { line: "keep_entry" } } }),
  );
  expect(call.mock.calls.filter(([, request]) => request.action === "confirm")).toHaveLength(1);
});
