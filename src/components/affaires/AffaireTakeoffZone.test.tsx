import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AffaireTakeoffZone } from "@/components/affaires/AffaireTakeoffZone";
import type { AffaireTakeoffZoneData } from "@/lib/takeoff/affaire-takeoff-zone";

const { assume, read, dialog } = vi.hoisted(() => ({ assume: vi.fn(), read: vi.fn(), dialog: vi.fn() }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  assumeTakeoffLaunchRequestAction: assume, readAffaireTakeoffZoneAction: read,
}));
vi.mock("@/components/affaires/LaunchMetreDialog", () => ({
  LaunchMetreDialog: (props: { open: boolean; launchMode: unknown }) => {
    dialog(props);
    return props.open ? <div role="dialog" aria-label="Préparer le métré" /> : null;
  },
}));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/navigation/NavigationFeedback", () => ({
  NavigationLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    <a href={href} className={className}>{children}</a>,
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";

function blocked(overrides: Partial<NonNullable<AffaireTakeoffZoneData["request"]>> = {}): AffaireTakeoffZoneData {
  return {
    active: true, canOperate: true, confirmedBeforeActivation: false, dossierChangedSinceAnalysis: null, latestJob: null, latestReview: null, latestEnd: null,
    request: { id: requestId, origin: "automatic", state: "blocked", mandateRevision: 4, reason: "MANDATE_REQUIRED", pieces: [],
      hasPayer: false, payerIsViewer: false, createdAt: "2026-11-21T08:00:00.000Z", admittedAt: null, closedAt: null, outcome: null,
      units: { expected: null, succeeded: 0, failed: 0, canceled: 0 }, action: "take_on", jobs: [], coverage: null,
      completionEventId: null, ...overrides },
  };
}

function show(data: AffaireTakeoffZoneData, canOperate = true, onChanged = vi.fn()) {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AffaireTakeoffZone projectId={projectId} initialData={data} dossier="confirmed" planFileCount={1} canOperate={canOperate}
      currentVersion={null} availableVersions={[]} plansContext={null} onReviewBrief={vi.fn()} onOpenDocuments={vi.fn()}
      onAddDocuments={vi.fn()} onChanged={onChanged} />
  </SWRConfig>);
  return { onChanged };
}

describe("AffaireTakeoffZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockImplementation(async () => ({ ok: true, data: blocked() }));
  });
  afterEach(() => cleanup());

  it("takes the request on with the revision and the action the zone showed, then reads the affaire again", async () => {
    assume.mockResolvedValue({ ok: true, data: { requestId, state: "evaluating", reason: null, message: null, action: "none", actionLabel: null } });
    const { onChanged } = show(blocked());
    expect(screen.getByRole("region", { name: "Métré de l’affaire" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Prendre en charge avec mon forfait" }));
    expect(assume).toHaveBeenCalledWith({ projectId, requestId, seenRevision: 4, action: "take_on" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("says a refused gesture in the zone and keeps the state shown", async () => {
    assume.mockResolvedValue({ ok: false, error: { status: 409, code: "CONFLICT", retryable: false,
      message: "Le métré de cette affaire a changé depuis votre lecture. Actualisez avant de le prendre en charge." } });
    const { onChanged } = show(blocked());
    await userEvent.setup().click(screen.getByRole("button", { name: "Prendre en charge avec mon forfait" }));
    expect(await screen.findByText("Le métré de cette affaire a changé depuis votre lecture. Actualisez avant de le prendre en charge.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("opens the options in the mode the zone decided, and offers a reader neither gesture nor options", async () => {
    show(blocked());
    await userEvent.setup().click(screen.getByRole("button", { name: "Options du métré" }));
    expect(screen.getByRole("dialog", { name: "Préparer le métré" })).toBeInTheDocument();
    expect(dialog).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, launchMode: expect.objectContaining({ kind: "save_only" }) }));
    cleanup();
    show(blocked({ reason: "OPERATOR_REQUIRED", action: "none" }), false);
    expect(screen.getByText("Métré non démarré — prise en charge par un métreur requise")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prendre en charge|Options du métré/ })).not.toBeInTheDocument();
  });
});
