import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";
import { useAffaireDossier, useDossierPoll, type AffaireDossier } from "./useAffaireDossier";
import { type AffaireHubPlansSummaryData } from "@/lib/affaires/hub-plans-summary";

// The dossier is read through the application's API, never through the router: a refresh of the
// router holds back what a save brings to the screen until its own data has landed (TI-722).
// Each test reads its own affaire: what a read showed is remembered per affaire across mounts.
let projectId = "project-0";
let projectCount = 0;

const workspace = (name: string, classificationStatus = "processing") => ({
  projectId: "project-1", uploadId: "upload-1", missingPieces: [], briefDraft: null,
  documents: [{ documentId: "document-1", fileName: name, detectedCategory: "plans", confidence: .9, issues: [], extractedMetadata: {},
    uploadStatus: "uploaded", classificationStatus }],
}) as unknown as AffaireIntakeWorkspace;
const plans = (planFileCount: number) => ({ planFileCount }) as unknown as AffaireHubPlansSummaryData;

type Answer = { workspace: AffaireIntakeWorkspace; plansSummary?: AffaireHubPlansSummaryData | null } | "failure" | 401;
const reads: Array<{ url: string; answer: (value: Answer) => void }> = [];

function respond(index: number, value: Answer) {
  return act(async () => { reads[index].answer(value); await Promise.resolve(); });
}

const probe: { dossier: AffaireDossier | null } = { dossier: null };
function Probe({ server, serverPlans = null, withPlans = false, live }: { server: AffaireIntakeWorkspace; serverPlans?: AffaireHubPlansSummaryData | null; withPlans?: boolean; live?: boolean }) {
  const dossier = useAffaireDossier(projectId, { workspace: server, plansSummary: serverPlans }, { plans: withPlans, live });
  useEffect(() => { probe.dossier = dossier; });
  return <p>{dossier.workspace?.documents[0].fileName} · {dossier.plansSummary?.planFileCount ?? "aucun plan"}</p>;
}

beforeEach(() => {
  reads.length = 0;
  probe.dossier = null;
  projectCount += 1;
  projectId = `project-${projectCount}`;
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise((resolve, reject) => {
    reads.push({ url, answer: (value) => value === "failure"
      ? reject(new TypeError("Failed to fetch"))
      : value === 401
        ? resolve(new Response(JSON.stringify({ ok: false, error: { message: "Session expirée." } }), { status: 401, headers: { "content-type": "application/json" } }))
        : resolve(new Response(JSON.stringify({ ok: true, data: value }), { status: 200, headers: { "content-type": "application/json" } })) });
  })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("useAffaireDossier", () => {
  it("shows what a read brings without refreshing the router", async () => {
    render(<Probe server={workspace("plan.pdf")} />);
    let reloaded: Promise<void> | undefined;
    act(() => { reloaded = probe.dossier!.reload(); });
    expect(reads.map((read) => read.url)).toEqual([`/api/affaires/${projectId}/intake`]);
    await respond(0, { workspace: workspace("plan-indice-b.pdf", "classified") });
    await act(async () => { await reloaded; });
    expect(screen.getByText("plan-indice-b.pdf · aucun plan")).toBeInTheDocument();
  });

  it("drops a read that started before the server rendered the page again", async () => {
    // A save re-renders the page in its own response: a read sent before it may predate the save.
    const { rerender } = render(<Probe server={workspace("plan.pdf")} />);
    act(() => { void probe.dossier!.reload(); });
    rerender(<Probe server={workspace("plan-enregistre.pdf")} />);
    await respond(0, { workspace: workspace("plan-avant-enregistrement.pdf") });
    expect(screen.getByText("plan-enregistre.pdf · aucun plan")).toBeInTheDocument();
  });

  it("gives way to the server's next render after a read, and reads once to check it is not older", async () => {
    // A save's response renders the page from data it read before a later read had answered.
    const { rerender } = render(<Probe server={workspace("plan.pdf")} />);
    act(() => { void probe.dossier!.reload(); });
    await respond(0, { workspace: workspace("plan-lu.pdf") });
    expect(screen.getByText("plan-lu.pdf · aucun plan")).toBeInTheDocument();
    rerender(<Probe server={workspace("plan-rendu.pdf")} />);
    expect(screen.getByText("plan-rendu.pdf · aucun plan")).toBeInTheDocument();
    expect(reads).toHaveLength(2);
    await respond(1, { workspace: workspace("plan-lu-apres.pdf") });
    expect(screen.getByText("plan-lu-apres.pdf · aucun plan")).toBeInTheDocument();
    // The server's render already matches the read on screen: nothing more to check.
    rerender(<Probe server={workspace("plan-lu-apres.pdf")} />);
    expect(reads).toHaveLength(2);
  });

  it("reads once when the page comes back with a render older than what a read showed", async () => {
    // Back and forward bring back the router's cached render, whatever the reads showed since.
    const first = render(<Probe server={workspace("plan.pdf")} />);
    act(() => { void probe.dossier!.reload(); });
    await respond(0, { workspace: workspace("plan-ajoute.pdf") });
    first.unmount();
    render(<Probe server={workspace("plan.pdf")} />);
    expect(reads).toHaveLength(2);
    await respond(1, { workspace: workspace("plan-ajoute.pdf") });
    expect(screen.getByText("plan-ajoute.pdf · aucun plan")).toBeInTheDocument();
  });

  it("reads nothing over a page that shows made-up data", async () => {
    // The development scenarios of the hub render a fictional dossier.
    const first = render(<Probe server={workspace("plan.pdf")} />);
    act(() => { void probe.dossier!.reload(); });
    await respond(0, { workspace: workspace("plan-ajoute.pdf") });
    first.unmount();
    render(<Probe server={workspace("scenario.pdf")} live={false} />);
    await act(async () => { await probe.dossier!.reload(); });
    expect(reads).toHaveLength(1);
    expect(screen.getByText("scenario.pdf · aucun plan")).toBeInTheDocument();
  });

  it("sends no read when the page opens on an affaire no read has shown", () => {
    render(<Probe server={workspace("plan.pdf")} />);
    expect(reads).toHaveLength(0);
  });

  it("sends one read at a time and one more for the reloads asked during it", async () => {
    render(<Probe server={workspace("plan.pdf")} />);
    let pending: Promise<void>[] = [];
    act(() => { pending = [probe.dossier!.reload(), probe.dossier!.reload(), probe.dossier!.reload()]; });
    expect(reads).toHaveLength(1);
    // The reloads asked during the first read may come from an upload it does not contain yet.
    await respond(0, { workspace: workspace("plan-1.pdf") });
    expect(reads).toHaveLength(2);
    await respond(1, { workspace: workspace("plan-2.pdf") });
    await act(async () => { await Promise.all(pending); });
    expect(reads).toHaveLength(2);
    expect(screen.getByText("plan-2.pdf · aucun plan")).toBeInTheDocument();
  });

  it("stops reading once the server refuses the read, and lets the page answer", async () => {
    // An expired session or a withdrawn access: the page reloads (jsdom does not navigate), and its
    // own request redirects or refuses. No read is sent any more.
    render(<Probe server={workspace("plan.pdf")} />);
    act(() => { void probe.dossier!.reload(); });
    await respond(0, 401);
    await act(async () => { await probe.dossier!.reload(); });
    expect(reads).toHaveLength(1);
    expect(screen.getByText("plan.pdf · aucun plan")).toBeInTheDocument();
  });

  it("keeps the documents on screen when a read fails", async () => {
    render(<Probe server={workspace("plan.pdf")} />);
    let reloaded: Promise<void> | undefined;
    act(() => { reloaded = probe.dossier!.reload(); });
    await respond(0, "failure");
    await act(async () => { await expect(reloaded).resolves.toBeUndefined(); });
    expect(screen.getByText("plan.pdf · aucun plan")).toBeInTheDocument();
    act(() => { void probe.dossier!.reload(); });
    expect(reads).toHaveLength(2);
  });

  it("reads the plans only when asked, and keeps the server's when a read brings none", async () => {
    const { rerender } = render(<Probe server={workspace("plan.pdf")} serverPlans={plans(1)} withPlans />);
    act(() => { void probe.dossier!.reload(); });
    expect(reads[0].url).toBe(`/api/affaires/${projectId}/intake?plans=1`);
    await respond(0, { workspace: workspace("plan.pdf"), plansSummary: plans(2) });
    expect(screen.getByText("plan.pdf · 2")).toBeInTheDocument();
    // A read that could not read the plans keeps those the previous read showed.
    act(() => { void probe.dossier!.reload(); });
    await respond(1, { workspace: workspace("plan-bis.pdf") });
    expect(screen.getByText("plan-bis.pdf · 2")).toBeInTheDocument();
    // Over a new server render, it keeps the server's.
    rerender(<Probe server={workspace("plan-bis.pdf")} serverPlans={plans(1)} withPlans />);
    act(() => { void probe.dossier!.reload(); });
    await respond(reads.length - 1, { workspace: workspace("plan-ter.pdf") });
    expect(screen.getByText("plan-ter.pdf · 1")).toBeInTheDocument();
  });
});

// The page waits on what the server stored about the dossier's analysis (intake-follow.ts): one wait, one cadence, per
// batch, said on the page, and ended by the server's record or, past the server's own limits, by a visible offer to
// read again. Never a silent stop.
describe("useAffaireDossier wait", () => {
  const pending = (name: string, uploads: string[], classificationStatus = "classified", brief: unknown = null) => ({
    ...workspace(name, classificationStatus), pendingUploadIds: uploads, briefDraft: brief,
  }) as unknown as AffaireIntakeWorkspace;
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  function Follow({ server }: { server: AffaireIntakeWorkspace }) {
    const dossier = useAffaireDossier(projectId, { workspace: server });
    useEffect(() => { probe.dossier = dossier; });
    return <p>{dossier.workspace?.documents[0].fileName} · {dossier.follow}</p>;
  }

  beforeEach(() => { vi.useFakeTimers(); });

  it("reads while a batch's analysis runs, past two minutes, and stops when the server records its end", async () => {
    render(<Follow server={pending("plan.pdf", ["upload-1"])} />);
    expect(screen.getByText("plan.pdf · waiting")).toBeInTheDocument();
    // Transcriptions of a scanned piece can take minutes: three minutes later the page still reads.
    for (let minute = 0; minute < 45; minute += 1) {
      await tick(4000);
      await respond(reads.length - 1, { workspace: pending("plan.pdf", ["upload-1"]) });
    }
    expect(reads.length).toBe(45);
    expect(screen.getByText("plan.pdf · waiting")).toBeInTheDocument();
    await tick(4000);
    await respond(reads.length - 1, { workspace: pending("plan-brief.pdf", [], "classified", { status: "a_confirmer" }) });
    expect(screen.getByText("plan-brief.pdf · idle")).toBeInTheDocument();
    await tick(60_000);
    expect(reads.length).toBe(46);
  });

  it("keeps reading after a failed classification while the batch's analysis runs", async () => {
    render(<Follow server={pending("plan.pdf", ["upload-1"], "processing")} />);
    await tick(4000);
    await respond(0, { workspace: pending("plan.pdf", ["upload-1"], "failed") });
    await tick(4000);
    expect(reads.length).toBe(2);
    await respond(1, { workspace: pending("plan-secours.pdf", [], "failed", { status: "a_confirmer" }) });
    expect(screen.getByText("plan-secours.pdf · idle")).toBeInTheDocument();
  });

  it("starts a new wait for a new batch, after an earlier one ran out", async () => {
    render(<Follow server={pending("plan.pdf", ["upload-1"])} />);
    for (let elapsed = 0; elapsed < 15 * 60 * 1000; elapsed += 4000) {
      await tick(4000);
      if (reads.length && reads.at(-1)) await respond(reads.length - 1, { workspace: pending("plan.pdf", ["upload-1"]) });
    }
    await tick(4000);
    expect(screen.getByText("plan.pdf · overdue")).toBeInTheDocument();
    const before = reads.length;
    await tick(60_000);
    expect(reads.length).toBe(before);
    // The member adds a piece: its batch is followed whatever the previous one did.
    act(() => { void probe.dossier!.reload(); });
    await respond(reads.length - 1, { workspace: pending("plan-2.pdf", ["upload-1", "upload-2"]) });
    expect(screen.getByText("plan-2.pdf · waiting")).toBeInTheDocument();
    await tick(4000);
    expect(reads.length).toBe(before + 2);
  });

  it("offers to read again past the server's limits, and « Actualiser » reads and waits again", async () => {
    render(<Follow server={pending("plan.pdf", ["upload-1"])} />);
    for (let elapsed = 0; elapsed <= 15 * 60 * 1000; elapsed += 4000) {
      await tick(4000);
      await respond(reads.length - 1, { workspace: pending("plan.pdf", ["upload-1"]) });
    }
    await tick(4000);
    expect(screen.getByText("plan.pdf · overdue")).toBeInTheDocument();
    const before = reads.length;
    act(() => { probe.dossier!.refresh(); });
    expect(reads.length).toBe(before + 1);
    await respond(reads.length - 1, { workspace: pending("plan.pdf", ["upload-1"]) });
    expect(screen.getByText("plan.pdf · waiting")).toBeInTheDocument();
  });

  it("reads again after a failed read while it waits, and nothing once the page is gone", async () => {
    const view = render(<Follow server={pending("plan.pdf", ["upload-1"])} />);
    await tick(4000);
    await respond(0, "failure");
    await tick(4000);
    expect(reads.length).toBe(2);
    // A reload asked during a read would send one more read after it: never once the page is gone.
    act(() => { void probe.dossier!.reload(); });
    view.unmount();
    await respond(1, { workspace: pending("plan.pdf", ["upload-1"]) });
    await tick(60_000);
    expect(reads.length).toBe(2);
  });

  it("waits for nothing over a page whose dossier the server says is analysed", async () => {
    render(<Follow server={pending("plan.pdf", [])} />);
    expect(screen.getByText("plan.pdf · idle")).toBeInTheDocument();
    await tick(60_000);
    expect(reads.length).toBe(0);
  });
});

describe("useDossierPoll", () => {
  function Poller({ active, reload, maxMs }: { active: boolean; reload: () => Promise<void>; maxMs?: number }) {
    const { expired } = useDossierPoll(active, reload, { intervalMs: 2000, maxMs });
    return <p>{expired ? "expiré" : "en cours"}</p>;
  }

  it("asks again an interval after the previous answer, never during a read slower than the interval", async () => {
    vi.useFakeTimers();
    const answers: Array<() => void> = [];
    const reload = vi.fn(() => new Promise<void>((resolve) => { answers.push(resolve); }));
    render(<Poller active reload={reload} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => { answers[0](); await vi.advanceTimersByTimeAsync(1999); });
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("stops once there is nothing left to wait for", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(() => Promise.resolve());
    const { rerender } = render(<Poller active reload={reload} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(reload).toHaveBeenCalledTimes(1);
    rerender(<Poller active={false} reload={reload} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("gives up after its time budget and says so", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(() => Promise.resolve());
    render(<Poller active reload={reload} maxMs={5000} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(screen.getByText("en cours")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(screen.getByText("expiré")).toBeInTheDocument();
  });
});
