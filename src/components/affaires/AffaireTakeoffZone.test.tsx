import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AffaireTakeoffZone } from "@/components/affaires/AffaireTakeoffZone";
import { UserProvider, type UserProfile } from "@/lib/auth/user-context";
import type { AffaireTakeoffZoneData } from "@/lib/takeoff/affaire-takeoff-zone";
import { NO_PAYMENT_OPTIONS } from "@/lib/takeoff/payment-settings.test-fixtures";

const { assume, read, dialog } = vi.hoisted(() => ({ assume: vi.fn(), read: vi.fn(), dialog: vi.fn() }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  assumeTakeoffLaunchRequestAction: assume, readAffaireTakeoffZoneAction: read,
  readTakeoffPaymentOptionsAction: async () => NO_PAYMENT_OPTIONS,
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
const TENANT = "44444444-4444-4444-8444-444444444444";
const OPERATOR = { tenantId: TENANT, userId: "55555555-5555-4555-8555-555555555551" };
const DIRECTOR = { tenantId: TENANT, userId: "55555555-5555-4555-8555-555555555552" };

function blocked(overrides: Partial<NonNullable<AffaireTakeoffZoneData["request"]>> = {}): AffaireTakeoffZoneData {
  return {
    active: true, canOperate: true, confirmedWithoutRequest: false, dossierChangedSinceAnalysis: null, latestJob: null, latestReview: null, latestEnd: null,
    unrequestedRunning: false, viewer: OPERATOR,
    request: { id: requestId, origin: "automatic", state: "blocked", mandateRevision: 4, reason: "MANDATE_REQUIRED", pieces: [],
      hasPayer: false, payerIsViewer: false, createdAt: "2026-11-21T08:00:00.000Z", admittedAt: null, closedAt: null, outcome: null,
      units: { expected: null, succeeded: 0, failed: 0, canceled: 0 }, action: "take_on", canStart: true, jobs: [], coverage: null,
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

// The zone as a member of the tenant sees it, in a browser whose SWR cache outlives the page (`cache`).
function showAs(viewer: { tenantId: string; userId: string }, data: AffaireTakeoffZoneData | null, cache: Map<string, unknown>) {
  const profile = { id: viewer.userId, full_name: "Membre fictif", phone: null, job_title: null, work_email: null, role: "admin",
    ui_mode: "expert", tenant_id: viewer.tenantId, tenant_role: "engineer" } as unknown as UserProfile;
  return render(<SWRConfig value={{ provider: () => cache as never, dedupingInterval: 0 }}>
    <UserProvider initialUserEmail="membre@example.test" initialProfile={profile}>
      <AffaireTakeoffZone projectId={projectId} initialData={data} dossier="confirmed" planFileCount={1} canOperate
        currentVersion={null} availableVersions={[]} plansContext={null} onReviewBrief={vi.fn()} onOpenDocuments={vi.fn()}
        onAddDocuments={vi.fn()} onChanged={vi.fn()} />
    </UserProvider>
  </SWRConfig>);
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

  // One browser, two members (the session changed without a reload): each reads the zone the server read for them, never
  // the one cached for the other, and an answer the server read for another member is never shown.
  it("never shows a member the zone read for another member in the same browser", async () => {
    const cache = new Map<string, unknown>();
    // The operator's page could not be read by the server: the zone reads it once shown, and caches it.
    showAs(OPERATOR, null, cache);
    expect(await screen.findByRole("button", { name: "Prendre en charge avec mon forfait" })).toBeInTheDocument();
    cleanup();
    const director = { ...blocked({ reason: "OPERATOR_REQUIRED", action: "none" }), canOperate: false, viewer: DIRECTOR };
    showAs(DIRECTOR, director, cache);
    expect(screen.getByText("Métré non démarré — prise en charge par un métreur requise")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prendre en charge|Options du métré/ })).not.toBeInTheDocument();
  });

  it("never shows an answer the server read for another member than the page's", async () => {
    // The other member's answer names a piece the request left out, which this member may not read.
    read.mockImplementation(async () => ({ ok: true, data: blocked({ coverage: { plansRetained: 1,
      plansOmitted: [{ name: "Plan confidentiel indice C.pdf", reason: "alternate" }], referencesOmitted: [] } }) }));
    showAs(DIRECTOR, null, new Map());
    expect(await screen.findByText("L’état du métré n’a pas pu être lu. Réessayez dans un instant.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prendre en charge|Options du métré/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Plan confidentiel indice C");
    expect(document.body.textContent).not.toMatch(/plan retenu/);
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
