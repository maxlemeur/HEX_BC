import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Lot M3 (métré) — matrice d'admission du moteur 3, basculée par M2 v0.1.
// Avant M2, chaque entrée du métré refusait une v3 par son nom (TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED).
// M2 ouvre l'admission : la création, le lancement depuis un jeu de plans et l'application suivent
// pour une v3 exactement le chemin d'une v2. L'écriture des lignes v3 (unités du référentiel,
// statuts, provenance, montants du moteur, rejeu, refus nommés) est prouvée en base par
// supabase/tests/database/takeoff-apply-engine-v3.test.sql ; la traduction des refus SQL en
// erreurs API par server.apply.test.ts.

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffGeminiDeliveryConfigForTenant: vi.fn(),
  getTakeoffChunkingConfigForTenant: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: vi.fn(),
}));

vi.mock("@/lib/takeoff/dispatch-state", () => ({
  persistTakeoffDispatchOutcome: vi.fn(),
}));

// Fournisseur simulé : aucun magasin ChatGPT local, aucun hôte, aucune inférence.
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getTakeoffExecutionOwner: vi.fn() };
});

// Espion sur l'inspection PDF réelle : elle est atteinte pour une v3 comme pour une v2.
vi.mock("@/lib/estimates/source-reference-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/estimates/source-reference-pdf")>();
  return { ...actual, inspectSourceReferencePdf: vi.fn(actual.inspectSourceReferencePdf) };
});

import { POST as postTakeoffJob } from "@/app/api/takeoff/jobs/route";
import { POST as postTakeoffRetry } from "@/app/api/takeoff/jobs/[jobId]/retry/route";
import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { inspectSourceReferencePdf } from "@/lib/estimates/source-reference-pdf";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffGeminiDeliveryConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
  getTakeoffLowConfidenceThresholdForTenant,
} from "@/lib/takeoff/feature-flags";
import {
  applyTakeoffJob,
  createTakeoffJobFromPlanSet,
  resubmitTakeoffJob,
} from "@/lib/takeoff/server";
import {
  authenticatedContext,
  createSupabaseFake,
  estimateVersionRow,
  filterValue,
  M3_JOB_ID,
  M3_PLAN_SET_ID,
  M3_PROJECT_ID,
  M3_TENANT_ID,
  M3_VERSION_ID,
  takeoffJobRow,
  type FakeQuery,
  type SupabaseFake,
} from "@/lib/takeoff/metre-m3.test-utils";

const SECTION_ID = "99999999-9999-4999-8999-999999999999";

type Level = "A" | "B" | "C";
type Provider = "auto" | "gemini" | "chatgpt";

async function createPdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return new Uint8Array(await pdf.save());
}

async function buildCreateRequest(input: {
  level: Level;
  provider: Provider;
  idempotencyKey: string | null;
}) {
  const file =
    input.level === "A"
      ? new File(["designation;quantity;unit\nTube cuivre 22;12,5;ml"], "Métré R+1.csv", {
          type: "text/csv",
        })
      : new File([await createPdfBytes()], "PLB R+1 indice B.pdf", { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("estimate_version_id", M3_VERSION_ID);
  formData.append("level", input.level);
  formData.append("provider", input.provider);

  return new Request("http://localhost/api/takeoff/jobs", {
    method: "POST",
    headers: input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : undefined,
    body: formData,
  });
}

/** Faux Supabase de la création : version cible, recherche d'idempotence, dépôt, tâche, audit. */
function createCreationFake(input: {
  version: ReturnType<typeof estimateVersionRow>;
  existingJob?: ReturnType<typeof takeoffJobRow>;
}) {
  return createSupabaseFake({
    tables: {
      estimate_versions: () => ({ data: input.version, error: null }),
      takeoff_jobs: (query: FakeQuery) => {
        if (query.operation === "insert") {
          const payload = query.payload as Record<string, unknown>;
          return {
            data: { ...payload, created_at: "2026-10-24T00:00:00.000Z" },
            error: null,
          };
        }
        return { data: input.existingJob ?? null, error: null };
      },
      audit_logs: () => ({ data: null, error: null }),
    },
    storage: {
      "takeoff-files": () => ({ data: { path: "uploaded" }, error: null }),
    },
  });
}

function installFake(fake: SupabaseFake) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
}


/** Ce qu'un parcours a fait : réponse, dépôt, tâche, audit, inspection, fournisseur et lancement. */
function sideEffects(fake: SupabaseFake) {
  return {
    storage: fake.storageCalls.map((call) => call.method),
    jobWrites: fake.writesTo("takeoff_jobs").map((query) => query.operation),
    auditWrites: fake.writesTo("audit_logs").length,
    tables: [...new Set(fake.tablesTouched)].sort(),
    pdfInspections: vi.mocked(inspectSourceReferencePdf).mock.calls.length,
    executionOwners: vi.mocked(getTakeoffExecutionOwner).mock.calls.length,
    geminiConfigs: vi.mocked(getTakeoffGeminiDeliveryConfigForTenant).mock.calls.length,
    enabledChecks: vi.mocked(assertTakeoffEnabled).mock.calls.length,
    triggers: vi.mocked(triggerTakeoffJobProcessing).mock.calls.length,
    dispatches: vi.mocked(persistTakeoffDispatchOutcome).mock.calls.length,
  };
}

/** Rejoue la même requête sur une cible du moteur donné, avec un faux neuf et des espions remis à zéro. */
async function createOn(input: {
  engine: number;
  status?: "draft" | "sent";
  level: Level;
  provider: Provider;
  idempotencyKey: string | null;
  existingJob?: ReturnType<typeof takeoffJobRow>;
}) {
  vi.clearAllMocks();
  mockDefaults();
  const fake = createCreationFake({
    version: estimateVersionRow({ calcEngineVersion: input.engine, status: input.status }),
    existingJob: input.existingJob,
  });
  installFake(fake);
  const response = await postTakeoffJob(await buildCreateRequest(input));
  const body = (await response.json()) as { ok: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> };
  return {
    status: response.status,
    ok: body.ok,
    errorCode: body.error?.code ?? null,
    job: body.data ? { level: body.data.level, estimate_version_id: body.data.estimate_version_id } : null,
    effects: sideEffects(fake),
  };
}

const CREATION_MATRIX = (["A", "B", "C"] as const).flatMap((level) =>
  (["auto", "gemini", "chatgpt"] as const).flatMap((provider) =>
    [null, "m3-cle-idempotence"].map((idempotencyKey) => ({ level, provider, idempotencyKey }))
  )
);

function mockDefaults() {
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(getTakeoffGeminiDeliveryConfigForTenant).mockResolvedValue({ useBatchApi: false } as never);
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.6 as never);
  vi.mocked(getTakeoffExecutionOwner).mockResolvedValue({});
  vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
    triggered: true,
    correlationId: "00000000-0000-4000-8000-000000000000",
    statusCode: 202,
    outcome: "accepted",
  } as never);
  vi.mocked(persistTakeoffDispatchOutcome).mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaults();
});

describe("création par téléversement : une v3 suit le chemin d'une v2", () => {
  it.each(CREATION_MATRIX)(
    "niveau $level, fournisseur $provider, clé $idempotencyKey : 201, dépôt, tâche, audit et lancement comme en v2",
    async ({ level, provider, idempotencyKey }) => {
      const v2 = await createOn({ engine: 2, level, provider, idempotencyKey });
      const v3 = await createOn({ engine: 3, level, provider, idempotencyKey });

      expect(v3).toEqual(v2);
      expect(v3.status).toBe(201);
      expect(v3.effects.storage).toContain("upload");
      expect(v3.effects.jobWrites).toEqual(["insert"]);
      expect(v3.effects.triggers).toBe(1);
      if (level !== "A") expect(v3.effects.pdfInspections).toBe(1);
    }
  );

  it("une v3 envoyée reçoit le refus de lecture seule d'une v2 envoyée, avant tout dépôt", async () => {
    const v2 = await createOn({ engine: 2, status: "sent", level: "B", provider: "auto", idempotencyKey: null });
    const v3 = await createOn({ engine: 3, status: "sent", level: "B", provider: "auto", idempotencyKey: null });

    expect(v3).toEqual(v2);
    expect(v3.status).toBe(403);
    expect(v3.errorCode).toBe("READ_ONLY");
    expect(v3.effects.storage).toEqual([]);
    expect(v3.effects.jobWrites).toEqual([]);
    expect(v3.effects.triggers).toBe(0);
  });

  it("le rejeu d'une clé dont la tâche vise une v3 se comporte comme pour une v2", async () => {
    const existingJob = takeoffJobRow({ status: "pending" });
    const v2 = await createOn({ engine: 2, level: "B", provider: "auto", idempotencyKey: "m3-cle-rejeu", existingJob });
    const v3 = await createOn({ engine: 3, level: "B", provider: "auto", idempotencyKey: "m3-cle-rejeu", existingJob });

    expect(v3).toEqual(v2);
    // Une tâche existante et accessible dispense du drapeau, pour le rejeu seulement.
    expect(v3.effects.enabledChecks).toBe(0);
  });
});

describe("lancement depuis un jeu de plans", () => {
  it.each(
    (["B", "C"] as const).flatMap((level) =>
      (["auto", "gemini", "chatgpt"] as const).map((provider) => ({ level, provider }))
    )
  )("jeu de plans niveau $level, fournisseur $provider : une v3 passe la garde de version et lit le jeu", async ({ level, provider }) => {
    const fake = createSupabaseFake({
      tables: {
        estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3 }), error: null }),
        // Jeu absent : le parcours s'arrête au premier contrôle après la version, sans dépôt.
        plan_sets: () => ({ data: null, error: null }),
      },
    });
    installFake(fake);

    await expect(
      createTakeoffJobFromPlanSet({
        projectId: M3_PROJECT_ID,
        planSetId: M3_PLAN_SET_ID,
        estimateVersionId: M3_VERSION_ID,
        level,
        provider,
      })
    ).rejects.toMatchObject({ status: 404, code: TakeoffErrorCode.NOT_FOUND, message: "Jeu de plans introuvable." });

    expect(fake.tablesTouched).toEqual(["estimate_versions", "plan_sets"]);
    expect(filterValue(fake.queries[1] as FakeQuery, "id")).toBe(M3_PLAN_SET_ID);
    expect(getTakeoffExecutionOwner).toHaveBeenCalledTimes(1);
    expect(fake.storageCalls).toEqual([]);
  });

  it("garde le refus de brouillon : une v3 acceptée n'est pas une cible", async () => {
    const fake = createSupabaseFake({
      tables: {
        estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3, status: "accepted" }), error: null }),
      },
    });
    installFake(fake);

    await expect(
      createTakeoffJobFromPlanSet({
        projectId: M3_PROJECT_ID,
        planSetId: M3_PLAN_SET_ID,
        estimateVersionId: M3_VERSION_ID,
        level: "B",
      })
    ).rejects.toMatchObject({ status: 403, code: "READ_ONLY" });
    expect(fake.tablesTouched).toEqual(["estimate_versions"]);
    expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
  });
});

describe("application d'un résultat sur une v3", () => {
  // Plus aucune garde moteur côté serveur : l'application va directement à ses contrôles
  // (statut du job, revue, DPGF, verrou), puis à la RPC atomique qui choisit l'écrivain v3.
  it("ne relit pas le moteur : un job non terminé reçoit le conflit de statut, sans lire la version", async () => {
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: takeoffJobRow({ status: "failed" }), error: null }),
        estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3 }), error: null }),
        audit_logs: () => ({ data: null, error: null }),
      },
    });
    installFake(fake);

    await expect(
      applyTakeoffJob(M3_JOB_ID, { strategy: "merge", target_section_id: SECTION_ID })
    ).rejects.toMatchObject({ status: 409, code: TakeoffErrorCode.CONFLICT });

    expect(fake.tablesTouched).not.toContain("estimate_versions");
    expect(fake.rpcCalls).toEqual([]);
    const audits = fake.writesTo("audit_logs").map((query) => query.payload as Record<string, unknown>);
    expect(audits.map((audit) => audit.action)).toEqual(["takeoff.apply.failed"]);
  });
});

describe("reprise d'un job en échec : même admission que la création", () => {
  // La relance et la resoumission ne relisent pas le moteur de la version cible
  // (job-actions-server.ts) : depuis M2, tout moteur est admis à la création, la règle est la même.
  function createRetryFake() {
    return createSupabaseFake({
      tables: {
        takeoff_jobs: (query: FakeQuery) => {
          if (query.operation === "update") {
            return {
              data: takeoffJobRow({ ...(query.payload as Record<string, unknown>) }),
              error: null,
            };
          }
          return { data: takeoffJobRow({ status: "failed" }), error: null };
        },
        audit_logs: () => ({ data: null, error: null }),
        estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3 }), error: null }),
      },
    });
  }

  it("la route de relance remet le job en attente et relance le traitement", async () => {
    const fake = createRetryFake();
    installFake(fake);

    const response = await postTakeoffRetry(new Request(`http://localhost/api/takeoff/jobs/${M3_JOB_ID}/retry`, { method: "POST" }), {
      params: Promise.resolve({ jobId: M3_JOB_ID }),
    });

    expect(response.status).toBe(200);
    expect(fake.tablesTouched).not.toContain("estimate_versions");
    const [update] = fake.writesTo("takeoff_jobs");
    expect(update?.payload).toMatchObject({ status: "pending", retry_count: 1 });
    expect(filterValue(update as FakeQuery, "tenant_id")).toBe(M3_TENANT_ID);
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: M3_JOB_ID, trigger: "retry" })
    );
  });

  it("la resoumission accepte aussi le job", async () => {
    const fake = createRetryFake();
    installFake(fake);

    await expect(resubmitTakeoffJob(M3_JOB_ID)).resolves.toMatchObject({ command: "resubmit", outcome: "applied" });
    expect(fake.tablesTouched).not.toContain("estimate_versions");
  });
});
