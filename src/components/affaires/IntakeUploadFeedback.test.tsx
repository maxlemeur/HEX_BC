import { act, render, screen } from "@testing-library/react";
import { startTransition, use, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DossierDocument } from "@/lib/affaires/document-triage";
import { IntakeUploadFeedback, useIntakeUploadFeedback, type IntakeUploadEvent } from "./IntakeUploadFeedback";

// The router of Next renders a refresh inside a transition, on data that stays pending until
// the server answers (next/dist/client/components/app-router-instance.js, refresh, and
// router-reducer/reducers/refresh-reducer.js). The stand-in below does the same: every
// refresh() hands React a new pending promise inside a transition, so that the screen keeps
// its old documents until that promise settles, as in the browser.
const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  settle: [] as Array<(documents: unknown[]) => void>,
  publish: (() => {}) as (state: unknown) => void,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: router.refresh }) }));

const document = (documentId: string) => ({
  documentId, uploadStatus: "uploaded", classificationStatus: "processing", isBeingDeleted: false,
  detectedCategory: "plans", confidence: 0.9, issues: [],
}) as unknown as DossierDocument;

function Screen({ event }: { event: IntakeUploadEvent }) {
  const [state, setState] = useState<DossierDocument[] | Promise<DossierDocument[]>>([]);
  useEffect(() => { router.publish = setState as (state: unknown) => void; }, []);
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
    router.settle.length = 0;
    router.refresh.mockReset().mockImplementation(() => {
      const pending = new Promise<unknown[]>((resolve) => { router.settle.push(resolve); });
      startTransition(() => router.publish(pending));
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the analysis of an added document behind a refresh slower than its two-second rhythm", async () => {
    render(<Screen event={uploaded} />);
    expect(screen.getByText("plan.pdf — Intégration au dossier…")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // The server takes five seconds to answer: no second refresh may replace the one in flight.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    await act(async () => { router.settle[0]([document("document-1")]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("plan.pdf — Analyse en cours…")).toBeInTheDocument();
  });

  it("asks again two seconds after a refresh that did not bring the document", async () => {
    render(<Screen event={uploaded} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { router.settle[0]([]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("plan.pdf — Intégration au dossier…")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops asking once the document is classified", async () => {
    render(<Screen event={uploaded} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const classified = { ...document("document-1"), classificationStatus: "classified", classificationSource: "manual" } as DossierDocument;
    await act(async () => { router.settle[0]([classified]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText(/plan\.pdf/)).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps rendering finite when an upload starts behind an entry update held back by a refresh in flight", async () => {
    // React keeps an update it cannot apply yet, and replays every later update of the same
    // state at each render until it can: the entries then change identity at every render.
    // In the browser the update held back is a retirement asked by a commit of lower priority
    // than the refresh in flight; here it shares the transition of that refresh.
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
      useEffect(() => { router.publish = setState as (state: unknown) => void; }, []);
      return <Probe documents={state instanceof Promise ? use(state) : state} />;
    }
    const started = (batchId: string, fileName: string): IntakeUploadEvent => ({ type: "started", batchId, fileNames: [fileName], rejectedFiles: [] });

    render(<ProbeScreen />);
    await act(async () => {
      startTransition(() => {
        router.publish(new Promise<unknown[]>((resolve) => { router.settle.push(resolve); }));
        send(started("batch-1", "plan.pdf"));
      });
    });
    await act(async () => { send(started("batch-2", "cctp.pdf")); });
    expect(screen.getByText("cctp.pdf — Chargement en cours…")).toBeInTheDocument();
    expect(renders).toBeLessThan(10);

    await act(async () => { router.settle[0]([]); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("plan.pdf — Chargement en cours…")).toBeInTheDocument();
    expect(screen.getByText("cctp.pdf — Chargement en cours…")).toBeInTheDocument();
  });
});
