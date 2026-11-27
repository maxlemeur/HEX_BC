import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/local-dispatcher", () => ({ isTakeoffPlanDispatchActive: async () => true }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/launch-request-server", () => ({ readAffaireTakeoffLaunchState: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildAffaireTakeoffZone, describeAffaireTakeoffRequest } from "@/lib/takeoff/affaire-takeoff-zone";
import { readAffaireTakeoffZone, toAffaireTakeoffCoverage } from "@/lib/takeoff/affaire-takeoff-zone-server";
import { readAffaireTakeoffLaunchState } from "@/lib/takeoff/launch-request-server";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { createSupabaseFake, filterValue, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { TAKEOFF_KEY_STOP_MESSAGES } from "@/lib/takeoff/visible-status";

const TENANT = "bbbbbbbb-0000-4000-8000-000000000010";
const PROJECT = "bbbbbbbb-0000-4000-8000-000000000020";
const REQUEST = "bbbbbbbb-0000-4000-8000-000000000030";
const VIEWER = "bbbbbbbb-0000-4000-8000-000000000001";
const ALTERNATE = "bbbbbbbb-0000-4000-8000-000000000051";
const CCTP = "bbbbbbbb-0000-4000-8000-000000000061";
const PLAN_SET = "bbbbbbbb-0000-4000-8000-000000000040";
const REMOVED_PLAN = "bbbbbbbb-0000-4000-8000-000000000052";
const JOB = "bbbbbbbb-0000-4000-8000-000000000070";

const manifest = {
  format_version: 1, budget: { tokens: 400000, cost_cents: 2500 },
  plans: [{ plan_file_id: "f1", content_sha256: "a".repeat(64), generation: "g1" }],
  references: [{ document_id: "d1", kind: "cctp", content_sha256: "b".repeat(64) }],
  coverage: {
    plans_retained: 1,
    plans_omitted: [{ id: ALTERNATE, name: "Plan RDC indice A.pdf", reason: "alternate", content_sha256: "c".repeat(64) },
      { id: "f3", name: "Inconnu.pdf", reason: "autre" }],
    references_omitted: [{ id: CCTP, name: "CCTP.docx", reason: "unsupported_format", file_path: "tenant/affaire/cctp.docx" }],
  },
};

// The manifest a request sealed holds digests, files, the budget and the plans' generations: a member's zone reads only
// how many plans it retained and the pieces it left out, by name and reason, never their ids.
describe("toAffaireTakeoffCoverage", () => {
  it("projects names and reasons only, and drops an entry it does not know", () => {
    expect(toAffaireTakeoffCoverage(manifest, "all")).toEqual({
      plansRetained: 1,
      plansOmitted: [{ name: "Plan RDC indice A.pdf", reason: "alternate" }],
      referencesOmitted: [{ name: "CCTP.docx", reason: "unsupported_format" }],
    });
    expect(JSON.stringify(toAffaireTakeoffCoverage(manifest, "all"))).not.toMatch(/sha256|cost_cents|file_path|generation|bbbbbbbb/);
  });

  it("shows no coverage for a request without a sealed manifest", () => {
    expect(toAffaireTakeoffCoverage(null, "all")).toBeNull();
    expect(toAffaireTakeoffCoverage({ coverage: {} }, "all")).toBeNull();
  });
});

// The zone names a piece the request left out only to a member who may read its plan file or its dossier piece (their own
// policies, under their session); anyone else reads a neutral name.
describe("readAffaireTakeoffZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPreparationProjectAccess).mockResolvedValue(undefined as never);
    vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ active: true, confirmedWithoutRequest: false,
      request: { id: REQUEST, origin: "automatic", state: "closed", mandateRevision: 1, reason: null, message: null, pieces: [],
        hasPayer: true, payerIsViewer: false, createdAt: "2026-11-21T08:00:00Z", admittedAt: "2026-11-21T08:05:00Z",
        closedAt: "2026-11-21T08:30:00Z", outcome: "success", jobId: null,
        units: { expected: 1, succeeded: 1, failed: 0, canceled: 0 }, action: "none", actionLabel: null },
      dossierChangedSinceAnalysis: null } as never);
    const service = createSupabaseFake({ tables: { takeoff_launch_requests: () => ({ data: { manifest }, error: null }) },
      rpc: {
        takeoff_launch_request_can_start: (args) => {
          canStartAsked.push(args);
          return { data: canStart, error: null };
        },
        takeoff_running_analysis_outside_request: (args) => {
          runningAsked.push(args);
          return { data: running, error: null };
        },
      } });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
    canStart = false;
    canStartAsked.length = 0;
    running = null;
    runningAsked.length = 0;
  });
  let canStart = false;
  const canStartAsked: unknown[] = [];
  let running: string | null = null;
  const runningAsked: unknown[] = [];

  function zone(rights: { owner?: boolean; readable?: string[] }, jobs: (query: FakeQuery) => unknown[] = () => []) {
    return read(rights, jobs).then((data) => data.request?.coverage);
  }

  function read(rights: { owner?: boolean; readable?: string[] }, jobs: (query: FakeQuery) => unknown[] = () => []) {
    const readable = new Set(rights.readable ?? []);
    const rows = (query: FakeQuery) => ({ data: ((filterValue(query, "id") as string[] | undefined) ?? [])
      .filter((id) => readable.has(id)).map((id) => ({ id })), error: null });
    const session = createSupabaseFake({
      tables: {
        takeoff_launch_requests: () => ({ data: { completion_event_id: null }, error: null }),
        takeoff_jobs: (query: FakeQuery) => ({ data: jobs(query), error: null }),
        plan_files: rows, affaire_intake_documents: rows,
      },
      rpc: {
        list_affaire_takeoff_completions: () => ({ data: [], error: null }),
        can_access_takeoff_project: () => ({ data: rights.owner ?? false, error: null }),
      },
    });
    return readAffaireTakeoffZone({ supabase: session.client, tenantId: TENANT, userId: VIEWER } as never, PROJECT);
  }

  // An analysis launched outside any request (before the activation) that something will still move: the database answers a
  // launch with it, and the zone only saves the options while it runs. The zone reads that rule from the database
  // (public.takeoff_running_analysis_outside_request, whose cases its pgTAP holds), never a copy of it.
  it("counts as running the analysis outside any request the database counts", async () => {
    running = JOB;
    expect((await read({ owner: true })).unrequestedRunning).toBe(true);
    expect(runningAsked).toEqual([{ p_tenant_id: TENANT, p_project_id: PROJECT }]);
  });

  // The former provider's failed analysis, with a retry recorded and no end: nothing will ever retry it (and a failed job
  // cannot be cancelled), the database admits a launch beside it, so the zone offers that launch.
  it("offers the launch beside a historical failure the database no longer counts as running", async () => {
    const historical = { id: JOB, status: "failed", estimate_version_id: null, plan_set_id: PLAN_SET, source_file_name: "plan.pdf",
      source_file_path: null, processing_strategy: "batch", provider_batch_state: null, error_code: "AI_TIMEOUT",
      created_at: "2026-10-01T08:00:00Z", completed_at: null, analysis_finished_at: null, execution_provider: "gemini",
      next_retry_at: "2026-10-01T09:00:00Z", analysis_outcome: null };
    const data = await read({ owner: true }, (query) => (filterValue(query, "status") === "failed"
      || filterValue(query, "launch_request_id") === undefined ? [historical] : []));
    expect(data.unrequestedRunning).toBe(false);
    const model = buildAffaireTakeoffZone({ projectId: PROJECT, data: { ...data, request: null }, dossier: "confirmed", planFileCount: 1,
      canOperate: true });
    expect(model?.options).toMatchObject({ mode: "request", predecessorJobId: JOB });
  });

  // A plan removed from the dossier since the analysis, which a director may not read: the shared reader masks it under
  // « Dossier modifié »; the analysis that read it must not name it either, wherever the answer lists that analysis.
  it("names no plan a director may not read anywhere in the answer, the analyses' own names included", async () => {
    const state = await readAffaireTakeoffLaunchState({} as never, PROJECT);
    vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ ...state,
      dossierChangedSinceAnalysis: { added: [], replaced: [], removed: [{ id: "hidden:removed:1", name: "Plan 1" }] } } as never);
    const analysis = { id: JOB, status: "completed", estimate_version_id: null, plan_set_id: PLAN_SET,
      source_file_name: "Plan RDC indice B (retiré).pdf", source_file_path: `${TENANT}/${PLAN_SET}/${REMOVED_PLAN}/plan-rdc-b.pdf`,
      processing_strategy: "sync", provider_batch_state: null, error_code: null, created_at: "2026-11-21T08:05:00Z",
      completed_at: "2026-11-21T08:30:00Z", analysis_finished_at: "2026-11-21T08:30:00Z" };
    const jobs = (query: FakeQuery) => {
      const statuses = filterValue(query, "status");
      if (filterValue(query, "launch_request_id") === REQUEST) return [analysis];
      if (Array.isArray(statuses)) return statuses.includes("completed") ? [analysis] : [];
      return statuses === "failed" ? [] : [analysis];
    };
    const director = await read({ readable: [] }, jobs);
    expect(director.request?.jobs.map((job) => job.name)).toEqual([null]);
    expect(director.latestJob?.name).toBeNull();
    expect(director.latestReview?.name).toBeNull();
    const answer = JSON.stringify(director);
    expect(answer).not.toContain("Plan RDC indice B");
    expect(answer).not.toContain(REMOVED_PLAN);
    expect(answer).not.toContain("plan-rdc-b");
    // Its owner or an administrator reads the analysis by its plan.
    expect((await read({ owner: true }, jobs)).latestJob?.name).toBe("Plan RDC indice B (retiré).pdf");
  });

  // The options only save while the automatic start can still begin (the database's rule for the member who reads);
  // otherwise they launch, setting that start aside.
  it("reads whether the automatic start can still begin, for the member who reads it", async () => {
    const state = await readAffaireTakeoffLaunchState({} as never, PROJECT);
    vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ ...state,
      request: { ...state.request!, state: "not_eligible", reason: "NO_EXPLOITABLE_PLAN", admittedAt: null, closedAt: null, outcome: null } } as never);
    expect((await read({ owner: true })).request?.canStart).toBe(false);
    canStart = true;
    expect((await read({ owner: true })).request?.canStart).toBe(true);
    expect(canStartAsked).toEqual([{ p_request_id: REQUEST, p_actor: VIEWER }, { p_request_id: REQUEST, p_actor: VIEWER }]);
  });

  // Follow-up of #684's review: a request a key paid, closed at one of its limits, names none of them in the zone either.
  // The zone reads its request's stored messages on the server, under the member's rights, and sends only the answer.
  describe("the note of a request closed under BUDGET_EXHAUSTED", () => {
    const BUDGET = "Métré arrêté — le budget de cette analyse est épuisé. Une nouvelle analyse se lance depuis les options du métré.";
    const NEUTRAL = "Métré arrêté — une limite de cette demande payée avec la clé API OpenAI est atteinte. Le motif est indiqué sur chaque plan.";
    const stopped = (error_code: string, error_message: string | null) => ({ id: JOB, status: "failed", estimate_version_id: null,
      plan_set_id: PLAN_SET, launch_unit_key: "plan:f1", source_file_name: "plan.pdf", source_file_path: null,
      processing_strategy: "sync", provider_batch_state: null, error_code, error_message, created_at: "2026-11-21T08:05:00Z",
      completed_at: "2026-11-21T08:30:00Z", analysis_finished_at: "2026-11-21T08:30:00Z" });
    async function note(rows: unknown[], reason = "BUDGET_EXHAUSTED") {
      const state = await readAffaireTakeoffLaunchState({} as never, PROJECT);
      vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ ...state,
        request: { ...state.request!, reason, outcome: "failure", units: { expected: 1, succeeded: 0, failed: 1, canceled: 0 } } } as never);
      const asked: Array<string | null> = [];
      const data = await read({ owner: true }, (query) => {
        if (filterValue(query, "launch_request_id") !== REQUEST) return [];
        asked.push(query.columns);
        return rows;
      });
      return { data, asked, message: describeAffaireTakeoffRequest(data.request!).message };
    }

    it.each(Object.entries(TAKEOFF_KEY_STOP_MESSAGES))("names no limit of a request a key paid (%s), and sends no stored text", async (_reason, text) => {
      const { data, asked, message } = await note([stopped("TAKEOFF_REQUEST_BUDGET_EXHAUSTED", text)]);
      expect(message).toBe(NEUTRAL);
      expect(data.request?.keyLimitReached).toBe(true);
      expect(asked[0]).toContain("error_message");
      expect(JSON.stringify(data)).not.toContain(text);
      expect(data.request?.jobs[0]).not.toHaveProperty("error_message");
    });

    it("keeps the budget's note on a plan's subscription, without a readable key stop, and for any other stored text", async () => {
      // A ChatGPT plan's request: its ledger records its own text.
      expect((await note([stopped("TAKEOFF_REQUEST_BUDGET_EXHAUSTED", "Le budget de cette analyse était épuisé avant la lecture de ce plan.")])).message)
        .toBe(BUDGET);
      // No job of the request this member reads.
      expect((await note([])).message).toBe(BUDGET);
      // A key's text under another code, or a text that differs by a character, is no key stop.
      expect((await note([stopped("AI_PROVIDER", TAKEOFF_KEY_STOP_MESSAGES.confirmedCalls)])).message).toBe(BUDGET);
      expect((await note([stopped("TAKEOFF_REQUEST_BUDGET_EXHAUSTED", `${TAKEOFF_KEY_STOP_MESSAGES.dollarCeiling} `)])).message).toBe(BUDGET);
      expect((await note([stopped("TAKEOFF_REQUEST_BUDGET_EXHAUSTED", null)])).data.request?.keyLimitReached).toBe(false);
    });
  });

  // One analysis per plan: the request's analyses come in the order its manifest records (its plans' names), so that the
  // analysis a later command replaces by default is its first unit, never the one whose key sorts first; a plan a command
  // did not name because an earlier analysis read it is shown as such.
  it("lists a request's analyses in its manifest's order and shows the plans an earlier analysis read", async () => {
    const [firstPlan, secondPlan] = ["bbbbbbbb-0000-4000-8000-0000000000f2", "bbbbbbbb-0000-4000-8000-0000000000f1"];
    const perPlan = { ...manifest, format_version: 2,
      units: [{ key: `plan:${firstPlan}`, ordinal: 1, plans: [firstPlan] }, { key: `plan:${secondPlan}`, ordinal: 2, plans: [secondPlan] }],
      coverage: { plans_retained: 2, references_omitted: [],
        plans_omitted: [{ id: ALTERNATE, name: "Plan lu avant.pdf", reason: "not_requested", generation: "g1" }] } };
    vi.mocked(createServiceRoleClient).mockReturnValue(createSupabaseFake({
      tables: { takeoff_launch_requests: () => ({ data: { manifest: perPlan }, error: null }) },
      rpc: { takeoff_launch_request_can_start: () => ({ data: false, error: null }),
        takeoff_running_analysis_outside_request: () => ({ data: null, error: null }) } }).client as never);
    const analysis = (id: string, plan: string) => ({ id, status: "completed", estimate_version_id: null, plan_set_id: PLAN_SET,
      launch_unit_key: `plan:${plan}`, source_file_name: `${plan}.pdf`, source_file_path: `${TENANT}/${PLAN_SET}/${plan}/plan.pdf`,
      processing_strategy: "sync", provider_batch_state: null, error_code: null, created_at: "2026-11-21T08:05:00Z",
      completed_at: "2026-11-21T08:30:00Z", analysis_finished_at: "2026-11-21T08:30:00Z" });
    const first = analysis("bbbbbbbb-0000-4000-8000-000000000071", firstPlan);
    const second = analysis("bbbbbbbb-0000-4000-8000-000000000072", secondPlan);
    // The database returns them by their keys: the second plan's sorts first.
    const jobs = (query: FakeQuery) => filterValue(query, "launch_request_id") === REQUEST ? [second, first] : [];
    const data = await read({ owner: true }, jobs);
    expect(data.request?.jobs.map((job) => job.id)).toEqual([first.id, second.id]);
    expect(data.request?.coverage?.plansOmitted).toEqual([{ name: "Plan lu avant.pdf", reason: "not_requested" }]);
  });

  it("counts nothing as running once every analysis outside a request ended", async () => {
    await expect(read({ owner: true }).then((data) => data.unrequestedRunning)).resolves.toBe(false);
  });

  it("names the pieces left out to the affaire's owner or an administrator", async () => {
    await expect(zone({ owner: true })).resolves.toEqual({ plansRetained: 1,
      plansOmitted: [{ name: "Plan RDC indice A.pdf", reason: "alternate" }],
      referencesOmitted: [{ name: "CCTP.docx", reason: "unsupported_format" }] });
  });

  it("names only the pieces whose rows the member reads", async () => {
    await expect(zone({ readable: [CCTP] })).resolves.toEqual({ plansRetained: 1,
      plansOmitted: [{ name: "Plan 1", reason: "alternate" }],
      referencesOmitted: [{ name: "CCTP.docx", reason: "unsupported_format" }] });
  });

  it("gives a neutral name to every piece the member may not read", async () => {
    const coverage = await zone({ readable: [] });
    expect(coverage).toEqual({ plansRetained: 1,
      plansOmitted: [{ name: "Plan 1", reason: "alternate" }],
      referencesOmitted: [{ name: "Pièce 1", reason: "unsupported_format" }] });
    expect(JSON.stringify(coverage)).not.toMatch(/RDC|CCTP|bbbbbbbb/);
  });
});
