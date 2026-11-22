import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { UserProvider, type UserProfile } from "@/lib/auth/user-context";
import { beginTakeoffLaunch } from "@/lib/takeoff/launch-intent-key";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const launchTakeoffFromSourceVersionPlanSetMock = vi.hoisted(() => vi.fn());
const relaunchTakeoffMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchPreparedTakeoffFromPlanSetAction: launchTakeoffFromPlanSetMock,
  launchPreparedTakeoffFromSourceVersionPlanSetAction: launchTakeoffFromSourceVersionPlanSetMock,
  relaunchTakeoffAction: relaunchTakeoffMock,
}));

vi.mock("@/components/takeoff/TakeoffPreparationPanel", () => ({
  TakeoffPreparationPanel: (props: import("@/components/takeoff/TakeoffPreparationPanel").TakeoffPreparationPanelProps) =>
    <div data-estimate-version={props.estimateVersionId ?? "none"} data-analysis-only={String(Boolean(props.analysisOnly))}>{props.documentControls}{props.destinationControls}{props.launchNotice ? <p>{props.launchNotice}</p> : null}<button type="button" disabled={props.disabled || props.launchDisabled} onClick={() => void props.onLaunch(7, 1)}>Confirmer et lancer le métré</button></div>,
}));

vi.mock("@/components/feedback/toast-provider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warning: toastWarningMock,
    error: vi.fn(),
  }),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: "11111111-1111-1111-1111-111111111111",
  currentVersion: {
    id: "33333333-3333-4333-8333-333333333333",
    status: "draft",
    versionNumber: 3,
  },
  availableVersions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      versionNumber: 3,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      versionNumber: 2,
    },
  ],
  availablePlanSets: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Plans import",
      source: "affaire-intake",
      fileCount: 5,
    },
  ],
  plansContext: {
    defaultPlanSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    defaultPlanSetName: "Plans import",
    defaultPlanSetSource: "affaire-intake",
    defaultPlanSetFileCount: 5,
    launchRecommendation: {
      documentClass: "tabular_pdf" as const,
      recommendedLevel: "B" as const,
      compatibleLevels: ["B", "C"] as Array<"B" | "C">,
      recommendationStrength: "high" as const,
      warningCode: null,
      warningMessage: null,
      signals: {
        mimeType: "application/pdf",
        extension: "pdf",
        fileCount: 5,
        totalPageCount: 2,
        matchedTableHints: ["dpgf"],
        matchedPlanHints: [],
      },
    },
  },
};

const TENANT = "66666666-6666-4666-8666-666666666666";
const MEMBER = "77777777-7777-4777-8777-777777777771";
const OTHER_MEMBER = "77777777-7777-4777-8777-777777777772";

/** The dialogue as a member of the tenant opens it (the page's user context). */
function as(userId: string, element: React.ReactElement) {
  const profile = { id: userId, full_name: "Membre fictif", phone: null, job_title: null, work_email: null, role: "admin",
    ui_mode: "expert", tenant_id: TENANT, tenant_role: "engineer" } as unknown as UserProfile;
  return <UserProvider initialUserEmail="membre@example.test" initialProfile={profile}>{element}</UserProvider>;
}

describe("LaunchMetreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not promise recovery when its persistence is unconfirmed", async () => {
    const user = userEvent.setup();
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: {
      jobId: "job-unconfirmed",
      dispatch: {
        status: "persistence_unconfirmed",
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        persisted: false,
      },
    } });

    render(<LaunchMetreDialog {...defaultProps} />);
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));

    expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith(expect.objectContaining({ level: "C", provider: "chatgpt" }));
    expect(
      await screen.findByText("Analyse créée, reprise à vérifier")
    ).toBeInTheDocument();
    expect(screen.getByText(/reprise automatique n'a pas pu être confirmée/i)).toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Analyse créée, reprise à vérifier" })
    );
  });

  it("reports the confirmed plan count instead of counting a discarded revision", async () => {
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: {
      jobId: "job-active", dispatch: { status: "running", persisted: true },
    } });
    render(<LaunchMetreDialog {...defaultProps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText(/— 1 fichier de plan[.]/)).toBeInTheDocument();
  });

  it("shows the safe launch conflict without reporting a successful analysis", async () => {
    const message = "Les plans ont changé depuis la confirmation. Vérifiez les sources avant de relancer.";
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: false, error: { status: 409, code: "TAKEOFF_CONFLICT", message, retryable: false } });
    render(<LaunchMetreDialog {...defaultProps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Analyse transmise au traitement")).not.toBeInTheDocument();
  });

  describe("once the automatic start is on", () => {
    const predecessor = "44444444-4444-4444-8444-444444444444";
    const request = (overrides: Partial<Parameters<typeof LaunchMetreDialog>[0]> = {}) =>
      <LaunchMetreDialog {...defaultProps} launchMode={{ kind: "request", predecessorJobId: predecessor }} {...overrides} />;

    it("launches a request on the clicker's subscription without any version and without creating a draft", async () => {
      relaunchTakeoffMock.mockResolvedValue({ ok: true, data: { outcome: "admitted", requestId: "r1", jobId: "j1" } });
      render(request());
      const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
      expect(screen.queryByLabelText("Version cible")).not.toBeInTheDocument();
      // The dialogue is rendered in a portal, outside the render's container.
      expect(document.querySelector("[data-estimate-version]")).toHaveAttribute("data-estimate-version", "none");
      expect(document.querySelector("[data-analysis-only]")).toHaveAttribute("data-analysis-only", "true");
      await userEvent.setup().click(launch);
      expect(relaunchTakeoffMock).toHaveBeenCalledWith({ projectId: defaultProps.projectId, planSetId: defaultProps.availablePlanSets[0]!.id,
        preparationRevision: 7, intentKey: expect.stringMatching(/^[0-9a-f-]{36}$/), predecessorJobId: predecessor });
      expect(launchTakeoffFromPlanSetMock).not.toHaveBeenCalled();
      expect(launchTakeoffFromSourceVersionPlanSetMock).not.toHaveBeenCalled();
      expect(await screen.findByText("Analyse transmise au traitement")).toBeInTheDocument();
    });

    // The analysis to relaunch read a plan that has no working copy now: nothing is recorded, the member reads why, by
    // name, and chooses which of its other plans to read (none ticked in advance); that is a new command naming them.
    it("offers the other plans of an analysis that lost a plan's copy, and relaunches only those the member ticks", async () => {
      const user = userEvent.setup();
      const kept = "66666666-6666-4666-8666-666666666666";
      relaunchTakeoffMock.mockResolvedValueOnce({ ok: true, data: { outcome: "plans_to_choose", requestId: null, jobId: null,
        choice: { withoutCopy: [{ name: "plan-a.pdf", reason: "removed" }], remaining: [{ id: kept, name: "plan-b.pdf" }] } } })
        .mockResolvedValueOnce({ ok: true, data: { outcome: "admitted", requestId: "r3", jobId: "j3" } });
      render(request());
      await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
      expect(await screen.findByText("« plan-a.pdf » n’est plus dans les plans de l’affaire : l’analyse ne peut pas être relancée "
        + "telle quelle. Les autres plans peuvent être relus.")).toBeInTheDocument();
      expect(screen.queryByText("Analyse transmise au traitement")).not.toBeInTheDocument();
      const plan = screen.getByRole("checkbox", { name: "plan-b.pdf" });
      expect(plan).not.toBeChecked();
      const relaunch = screen.getByRole("button", { name: "Relancer les plans choisis" });
      expect(relaunch).toBeDisabled();
      await user.click(plan);
      await user.click(relaunch);
      expect(await screen.findByText("Analyse transmise au traitement")).toBeInTheDocument();
      const [first, second] = relaunchTakeoffMock.mock.calls.map(([input]) => input as { intentKey: string; planFileIds?: string[] });
      expect(first).not.toHaveProperty("planFileIds");
      expect(second).toMatchObject({ planFileIds: [kept], predecessorJobId: predecessor, preparationRevision: 7 });
      expect(second!.intentKey).not.toBe(first!.intentKey);
    });

    // Two tabs of the same member on the affaire: tab 2 sent plan C and its answer was lost; in tab 1 the member ticks B.
    // Tab 1 never sends C in B's place: it says so, and sends C again or sets it aside only when the member asks.
    const PLAN_B = "66666666-6666-4666-8666-666666666666";
    const PLAN_C = "66666666-6666-4666-8666-666666666667";
    const choose = async () => {
      const user = userEvent.setup();
      relaunchTakeoffMock.mockResolvedValueOnce({ ok: true, data: { outcome: "plans_to_choose", requestId: null, jobId: null,
        choice: { withoutCopy: [{ name: "plan-a.pdf", reason: "removed" }],
          remaining: [{ id: PLAN_B, name: "plan-b.pdf" }, { id: PLAN_C, name: "plan-c.pdf" }] } } })
        .mockResolvedValueOnce({ ok: true, data: { outcome: "admitted", requestId: "r4", jobId: "j4" } });
      render(as(MEMBER, request()));
      await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
      await user.click(await screen.findByRole("checkbox", { name: "plan-b.pdf" }));
      const otherTab = (planFileIds: string[]) => beginTakeoffLaunch({ tenantId: TENANT, userId: MEMBER, projectId: defaultProps.projectId },
        { predecessorJobId: predecessor, planSetId: defaultProps.availablePlanSets[0]!.id, preparationRevision: 7, planFileIds });
      return { user, otherTab };
    };
    const sentAt = (index: number) => relaunchTakeoffMock.mock.calls[index]![0] as { intentKey: string; planFileIds?: string[] };

    it("never sends another tab's unanswered command in place of the plans the member ticks, and sets it aside on request", async () => {
      const { user, otherTab } = await choose();
      const other = otherTab([PLAN_C]);
      await user.click(screen.getByRole("button", { name: "Relancer les plans choisis" }));
      expect(await screen.findByText(/Un lancement envoyé depuis un autre onglet attend encore sa réponse/)).toBeInTheDocument();
      expect(relaunchTakeoffMock).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("button", { name: "Le mettre de côté" }));
      expect(await screen.findByText("Analyse transmise au traitement")).toBeInTheDocument();
      expect(sentAt(1)).toMatchObject({ planFileIds: [PLAN_B] });
      expect(sentAt(1).intentKey).not.toBe(other.intentKey);
    });

    it("sends another tab's unanswered command again, with its own content, only when the member asks", async () => {
      const { user, otherTab } = await choose();
      const other = otherTab([PLAN_C]);
      await user.click(screen.getByRole("button", { name: "Relancer les plans choisis" }));
      await user.click(await screen.findByRole("button", { name: "Renvoyer ce lancement" }));
      expect(await screen.findByText("Analyse transmise au traitement")).toBeInTheDocument();
      expect(sentAt(1)).toMatchObject({ planFileIds: [PLAN_C], intentKey: other.intentKey });
      expect(relaunchTakeoffMock).toHaveBeenCalledTimes(2);
    });

    // Counterexample: the unanswered command is the very choice the member makes (its answer was lost): it is replayed
    // with its key, without any question.
    it("replays an unanswered choice of the same plans with its key", async () => {
      const { user, otherTab } = await choose();
      const same = otherTab([PLAN_B]);
      await user.click(screen.getByRole("button", { name: "Relancer les plans choisis" }));
      expect(await screen.findByText("Analyse transmise au traitement")).toBeInTheDocument();
      expect(sentAt(1)).toMatchObject({ planFileIds: [PLAN_B], intentKey: same.intentKey });
    });

    it("replays a click whose answer was lost with the same key, and gives a new click after an answer a new one", async () => {
      const user = userEvent.setup();
      relaunchTakeoffMock.mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ ok: false, error: { status: 500, code: "INTERNAL_ERROR", message: "Erreur serveur.", retryable: true } })
        .mockResolvedValueOnce({ ok: false, error: { status: 409, code: "CONFLICT", message: "Refus nommé.", retryable: false } })
        .mockResolvedValueOnce({ ok: true, data: { outcome: "already_running", requestId: "r0", jobId: "j0" } });
      render(request());
      const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
      await user.click(launch);
      await user.click(launch);
      expect(await screen.findByText("Erreur serveur.")).toBeInTheDocument();
      await user.click(launch);
      expect(await screen.findByText("Refus nommé.")).toBeInTheDocument();
      await user.click(launch);
      const keys = relaunchTakeoffMock.mock.calls.map(([input]) => (input as { intentKey: string }).intentKey);
      // A lost answer and a server error keep the key; a named refusal ends it.
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).toBe(keys[0]);
      expect(keys[3]).not.toBe(keys[2]);
      expect(await screen.findByText("Une analyse de l’affaire est déjà en cours")).toBeInTheDocument();
    });

    // A lost answer is settled before anything new: whatever the dialogue shows after a reload (its analysis may have
    // finished meanwhile, and the zone then names it as the one to replace), the member's next click on the affaire sends
    // the unanswered command again, with its key and its own content, and shows its answer; only a click after that answer
    // is a new command. Another member of the same browser never sends it.
    const clickOnce = async (element: React.ReactElement) => {
      const view = render(element);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
      await screen.findByText(/Impossible de lancer|Analyse existante retrouvée|Analyse transmise|déjà en cours/);
      view.unmount();
    };
    const sent = () => relaunchTakeoffMock.mock.calls.map(([input]) => input as { intentKey: string; predecessorJobId: string | null });
    const FINISHED = "55555555-5555-4555-8555-555555555555";

    it("settles a command whose answer was lost before any new one, after its analysis finished and a reload", async () => {
      relaunchTakeoffMock.mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ ok: true, data: { outcome: "replayed", requestId: "r1", jobId: FINISHED } })
        .mockResolvedValue({ ok: true, data: { outcome: "admitted", requestId: "r2", jobId: "j2" } });
      await clickOnce(as(MEMBER, request()));
      // The analysis that click launched finished; the reloaded affaire offers to relaunch it.
      const afterReload = request({ launchMode: { kind: "request", predecessorJobId: FINISHED } });
      render(as(MEMBER, afterReload));
      await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
      expect(await screen.findByText("Analyse existante retrouvée")).toBeInTheDocument();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toEqual({ ...sent()[0] });
      expect(sent()[1]!.predecessorJobId).toBe(predecessor);
      cleanup();
      // Its answer shown, a new click is a new command, naming the finished analysis.
      await clickOnce(as(MEMBER, afterReload));
      expect(sent()[2]).toMatchObject({ predecessorJobId: FINISHED });
      expect(sent()[2]!.intentKey).not.toBe(sent()[0]!.intentKey);
      // Another member of the same browser never sends the first member's command.
      relaunchTakeoffMock.mockRejectedValueOnce(new Error("network"));
      await clickOnce(as(MEMBER, request()));
      await clickOnce(as(OTHER_MEMBER, request()));
      expect(sent()[4]!.intentKey).not.toBe(sent()[3]!.intentKey);
    });

    // Two tabs of one member: an answer received in one ends the command for both; the other never sends its key again.
    it("never sends again a key settled in another tab", async () => {
      relaunchTakeoffMock.mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue({ ok: true, data: { outcome: "admitted", requestId: "r2", jobId: "j2" } });
      await clickOnce(as(MEMBER, request()));
      // The other tab's answer cleared the browser's entry.
      window.localStorage.clear();
      await clickOnce(as(MEMBER, request()));
      expect(sent()[1]!.intentKey).not.toBe(sent()[0]!.intentKey);
    });

    it("keeps no identifier of the member, the affaire or the command in the browser entry's name", async () => {
      relaunchTakeoffMock.mockRejectedValueOnce(new Error("network"));
      await clickOnce(as(MEMBER, request()));
      const names = Object.keys(window.localStorage);
      expect(names).toHaveLength(1);
      for (const id of [TENANT, MEMBER, defaultProps.projectId, predecessor, defaultProps.availablePlanSets[0]!.id]) {
        expect(names[0]).not.toContain(id);
      }
      expect(names[0]).toMatch(/^mergeone:takeoff-launch-command:v2:[0-9a-f]{64}$/);
    });

    it("launches nothing from options shown while another analysis waits or runs, and says why", async () => {
      render(<LaunchMetreDialog {...defaultProps} launchMode={{ kind: "save_only", reason: "Une analyse de l’affaire est en cours." }} />);
      expect(await screen.findByText("Une analyse de l’affaire est en cours.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
      expect(screen.queryByLabelText("Version cible")).not.toBeInTheDocument();
    });
  });

  describe("the member's choice against a caller that renders again", () => {
    const linkSetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherSetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const thirdSetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const draftId = defaultProps.currentVersion.id;
    const sourceId = "22222222-2222-4222-8222-222222222222";
    // A caller such as the activity centre maps its list on every render: each call builds equal options in a new array.
    const planSets = (counts: { link?: number; other?: number; third?: number } = {}) => [
      { id: linkSetId, name: "Plans import", source: "affaire-intake", fileCount: counts.link ?? 5 },
      { id: otherSetId, name: "Plans R+1", source: null, fileCount: counts.other ?? 3 },
      ...(counts.third === undefined ? [] : [{ id: thirdSetId, name: "Plans R+2", source: null, fileCount: counts.third }]),
    ];
    const versions = () => defaultProps.availableVersions.map((version) => ({ ...version }));
    const props = (overrides: Partial<Parameters<typeof LaunchMetreDialog>[0]> = {}) => ({
      ...defaultProps,
      currentVersion: { ...defaultProps.currentVersion },
      availableVersions: versions(),
      availablePlanSets: planSets(),
      initialPlanSetId: linkSetId,
      ...overrides,
    });
    const planSetSelect = () => screen.findByLabelText("Jeu de plans à analyser");
    const versionSelect = () => screen.findByLabelText("Version cible");

    it("keeps the plan set picked in the select and launches it", async () => {
      const user = userEvent.setup();
      launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: { jobId: "job-other", dispatch: { status: "running", persisted: true } } });
      const { rerender } = render(<LaunchMetreDialog {...props()} />);
      expect(await planSetSelect()).toHaveValue(linkSetId);

      await user.selectOptions(await planSetSelect(), otherSetId);
      expect(await planSetSelect()).toHaveValue(otherSetId);

      rerender(<LaunchMetreDialog {...props()} />);
      expect(await planSetSelect()).toHaveValue(otherSetId);
      // The list read again: another set appeared and the set of the link changed its file count.
      rerender(<LaunchMetreDialog {...props({ availablePlanSets: planSets({ link: 6, third: 2 }) })} />);
      expect(await planSetSelect()).toHaveValue(otherSetId);

      await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
      await screen.findByText("Analyse transmise au traitement");
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledTimes(1);
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith(expect.objectContaining({ planSetId: otherSetId, versionId: draftId }));
    });

    it("keeps the target version picked in the select and launches on it", async () => {
      const user = userEvent.setup();
      launchTakeoffFromSourceVersionPlanSetMock.mockResolvedValue({ ok: true, data: {
        jobId: "job-source", versionId: "44444444-4444-4444-8444-444444444444", dispatch: { status: "running", persisted: true },
      } });
      const { rerender } = render(<LaunchMetreDialog {...props()} />);
      expect(await versionSelect()).toHaveValue(draftId);

      await user.selectOptions(await versionSelect(), sourceId);
      rerender(<LaunchMetreDialog {...props()} />);
      expect(await versionSelect()).toHaveValue(sourceId);

      await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
      await screen.findByText("Analyse transmise au traitement");
      expect(launchTakeoffFromPlanSetMock).not.toHaveBeenCalled();
      expect(launchTakeoffFromSourceVersionPlanSetMock).toHaveBeenCalledWith(expect.objectContaining({ planSetId: linkSetId, sourceVersionId: sourceId }));
    });

    it("falls back when the picked set loses its files, and does not return to it by itself", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LaunchMetreDialog {...props()} />);
      await user.selectOptions(await planSetSelect(), otherSetId);
      expect(await planSetSelect()).toHaveValue(otherSetId);

      rerender(<LaunchMetreDialog {...props({ availablePlanSets: planSets({ other: 0 }) })} />);
      expect(await planSetSelect()).toHaveValue(linkSetId);
      rerender(<LaunchMetreDialog {...props()} />);
      expect(await planSetSelect()).toHaveValue(linkSetId);
    });

    it("falls back when the picked version disappears", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LaunchMetreDialog {...props()} />);
      await user.selectOptions(await versionSelect(), sourceId);
      expect(await versionSelect()).toHaveValue(sourceId);

      rerender(<LaunchMetreDialog {...props({ availableVersions: versions().filter((version) => version.id !== sourceId) })} />);
      expect(await versionSelect()).toHaveValue(draftId);
    });

    it("applies the set or the version of the link again when the link names another one", async () => {
      const user = userEvent.setup();
      const firstId = "11111111-1111-4111-8111-111111111111";
      const linked = (initialPlanSetId: string, initialVersionId: string) => props({
        availablePlanSets: planSets({ third: 2 }),
        availableVersions: [...versions(), { id: firstId, versionNumber: 1 }],
        initialPlanSetId,
        initialVersionId,
      });
      const { rerender } = render(<LaunchMetreDialog {...linked(linkSetId, draftId)} />);
      await user.selectOptions(await planSetSelect(), otherSetId);
      await user.selectOptions(await versionSelect(), sourceId);
      expect(await planSetSelect()).toHaveValue(otherSetId);
      expect(await versionSelect()).toHaveValue(sourceId);

      // The link names another set: that set is applied, and the version picked stands while the link names the same one.
      rerender(<LaunchMetreDialog {...linked(thirdSetId, draftId)} />);
      expect(await planSetSelect()).toHaveValue(thirdSetId);
      expect(await versionSelect()).toHaveValue(sourceId);
      rerender(<LaunchMetreDialog {...linked(thirdSetId, firstId)} />);
      expect(await planSetSelect()).toHaveValue(thirdSetId);
      expect(await versionSelect()).toHaveValue(firstId);
      // Back to the first link: its set and its version are applied again, the earlier picks no longer stand.
      rerender(<LaunchMetreDialog {...linked(linkSetId, draftId)} />);
      expect(await planSetSelect()).toHaveValue(linkSetId);
      expect(await versionSelect()).toHaveValue(draftId);
    });
  });
});
