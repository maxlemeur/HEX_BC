import { act, render, screen } from "@testing-library/react";
import { startTransition, use, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DossierDocument } from "@/lib/affaires/document-triage";
import { IntakeUploadFeedback, useIntakeUploadFeedback, type IntakeUploadEvent } from "./IntakeUploadFeedback";

// The documents arrive two ways: a read of the dossier, which the hook asks for while an added
// document integrates (TI-722: never a refresh of the router, which holds back what a save brings to
// the screen), and the server's renders, which the router hands over inside a transition. The
// stand-in below publishes both: a read's documents at once, a render's behind a pending promise.
const dossier = vi.hoisted(() => ({
  reload: vi.fn(),
  answers: [] as Array<(documents: unknown[]) => void>,
  settle: [] as Array<(documents: unknown[]) => void>,
  publish: (() => {}) as (state: unknown) => void,
}));

const document = (documentId: string) => ({
  documentId, uploadStatus: "uploaded", classificationStatus: "processing", isBeingDeleted: false,
  detectedCategory: "plans", confidence: 0.9, issues: [],
}) as unknown as DossierDocument;

function Screen({ event }: { event: IntakeUploadEvent }) {
  const [state, setState] = useState<DossierDocument[] | Promise<DossierDocument[]>>([]);
  useEffect(() => { dossier.publish = setState as (state: unknown) => void; }, []);
  const documents = state instanceof Promise ? use(state) : state;
  return <Feedback documents={documents} event={event} />;
}

function Feedback({ documents, event }: { documents: DossierDocument[]; event: IntakeUploadEvent }) {
  const feedback = useIntakeUploadFeedback("project-1", documents);
  const { onUploadEvent } = feedback;
  useEffect(() => { onUploadEvent(event); }, [event, onUploadEvent]);
  return <IntakeUploadFeedback feedback={feedback} />;
}

const uploaded: IntakeUploadEvent = {
  type: "completed", batchId: "batch-1",
  files: [{ documentId: "document-1", fileName: "plan.pdf", status: "uploaded", rejectionReason: null }],
};

describe("useIntakeUploadFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dossier.answers.length = 0;
    dossier.settle.length = 0;
    dossier.reload.mockReset().mockImplementation(() => new Promise<void>((resolve) => {
      dossier.answers.push((documents) => { dossier.publish(documents); resolve(); });
    }));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows an added document as the dossier's reads bring it, and asks for no read of its own", async () => {
    // One wait follows the batch: the dossier's (useAffaireDossier), on the server's record of its analysis. The
    // feedback only shows what those reads bring: a second rhythm would add whole-dossier reads to it.
    render(<Screen event={uploaded} />);
    expect(screen.getByText("plan.pdf — Intégration au dossier…")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(dossier.reload).not.toHaveBeenCalled();

    await act(async () => { dossier.publish([document("document-1")]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("plan.pdf — Analyse en cours…")).toBeInTheDocument();
    const classified = { ...document("document-1"), classificationStatus: "classified", classificationSource: "manual" } as DossierDocument;
    await act(async () => { dossier.publish([classified]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText(/plan\.pdf/)).not.toBeInTheDocument();
    expect(dossier.reload).not.toHaveBeenCalled();
  });

  it("keeps rendering finite when an upload starts behind an entry update held back by a refresh in flight", async () => {
    // React keeps an update it cannot apply yet, and replays every later update of the same
    // state at each render until it can: the entries then change identity at every render.
    // In the browser the update held back is a retirement asked by a commit of lower priority
    // than a server render in flight; here it shares the transition of that render.
    let renders = 0;
    let send: (event: IntakeUploadEvent) => void = () => {};
    function Probe({ documents }: { documents: DossierDocument[] }) {
      const feedback = useIntakeUploadFeedback("project-1", documents);
      const { onUploadEvent } = feedback;
      useEffect(() => {
        renders += 1;
        if (renders > 100) throw new Error("The upload feedback renders without end.");
        send = onUploadEvent;
      });
      return <IntakeUploadFeedback feedback={feedback} />;
    }
    function ProbeScreen() {
      const [state, setState] = useState<DossierDocument[] | Promise<DossierDocument[]>>([]);
      useEffect(() => { dossier.publish = setState as (state: unknown) => void; }, []);
      return <Probe documents={state instanceof Promise ? use(state) : state} />;
    }
    const started = (batchId: string, fileName: string): IntakeUploadEvent => ({ type: "started", batchId, fileNames: [fileName], rejectedFiles: [] });

    render(<ProbeScreen />);
    await act(async () => {
      startTransition(() => {
        dossier.publish(new Promise<unknown[]>((resolve) => { dossier.settle.push(resolve); }));
        send(started("batch-1", "plan.pdf"));
      });
    });
    await act(async () => { send(started("batch-2", "cctp.pdf")); });
    expect(screen.getByText("cctp.pdf — Chargement en cours…")).toBeInTheDocument();
    expect(renders).toBeLessThan(10);

    await act(async () => { dossier.settle[0]([]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("plan.pdf — Chargement en cours…")).toBeInTheDocument();
    expect(screen.getByText("cctp.pdf — Chargement en cours…")).toBeInTheDocument();
  });
});
