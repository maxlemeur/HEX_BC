import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// Lot M3 (métré) — matrice du refus moteur 3.
// ACTUEL : référence du refus nommé tel qu'il existe à 354c18a. Ces tests ne prouvent
// aucun succès futur : ils doivent basculer quand M2 (contrat et writer v3)
// ouvrira l'admission, et seulement à ce moment.
// FUTUR : critères en attente de M2, déclarés en `it.todo` sans figer d'API.

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

// Espion sur l'inspection PDF réelle : elle doit ne jamais être atteinte sur une v3.
vi.mock("@/lib/estimates/source-reference-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/estimates/source-reference-pdf")>();
  return { ...actual, inspectSourceReferencePdf: vi.fn(actual.inspectSourceReferencePdf) };
});

import { POST as postTakeoffJob } from "@/app/api/takeoff/jobs/route";
import { POST as postTakeoffRetry } from "@/app/api/takeoff/jobs/[jobId]/retry/route";
import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { inspectSourceReferencePdf } from "@/lib/estimates/source-reference-pdf";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  TAKEOFF_ENGINE_V3_UNSUPPORTED_MESSAGE,
  takeoffTargetEngineRefusal,
} from "@/lib/takeoff/engine-support";
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
  assertTakeoffSourceVersionSupported,
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
const V3_REFUSAL = {
  code: TakeoffErrorCode.TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED,
  message: TAKEOFF_ENGINE_V3_UNSUPPORTED_MESSAGE,
  details: { estimate_version_id: M3_VERSION_ID, calc_engine_version: 3 },
  retryable: false,
};

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

function useFake(fake: SupabaseFake) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
}

/** Preuve commune : aucun effet de bord avant le refus nommé. */
function expectNothingStarted(fake: SupabaseFake) {
  expect(fake.storageCalls).toEqual([]);
  expect(fake.writesTo("takeoff_jobs")).toEqual([]);
  expect(fake.writesTo("audit_logs")).toEqual([]);
  expect(fake.tablesTouched.every((table) => table === "estimate_versions" || table === "takeoff_jobs")).toBe(true);
  expect(inspectSourceReferencePdf).not.toHaveBeenCalled();
  expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
  expect(getTakeoffGeminiDeliveryConfigForTenant).not.toHaveBeenCalled();
  expect(triggerTakeoffJobProcessing).not.toHaveBeenCalled();
  expect(persistTakeoffDispatchOutcome).not.toHaveBeenCalled();
}

const CREATION_MATRIX = (["A", "B", "C"] as const).flatMap((level) =>
  (["auto", "gemini", "chatgpt"] as const).flatMap((provider) =>
    [null, "m3-cle-idempotence"].map((idempotencyKey) => ({ level, provider, idempotencyKey }))
  )
);

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("ACTUEL — résolution du moteur à la frontière du métré (référence 354c18a)", () => {
  it("refuse par son nom le seul moteur 3 et laisse passer 1, 2 et un moteur inconnu", () => {
    expect(takeoffTargetEngineRefusal(3)).toBe(TAKEOFF_ENGINE_V3_UNSUPPORTED_MESSAGE);
    expect(takeoffTargetEngineRefusal(1)).toBeNull();
    expect(takeoffTargetEngineRefusal(2)).toBeNull();
    expect(takeoffTargetEngineRefusal(null)).toBeNull();
  });

  // Écart de robustesse documenté pour M2 : les gardes serveur lisent le moteur avec la
  // résolution tolérante. Une colonne absente du `select` y vaut moteur 1 ; la variante
  // stricte existe déjà et refuserait. La colonne est NOT NULL en base : risque de dérive
  // de requête uniquement.
  it("lit une colonne absente ou nulle comme moteur 1 (tolérant), alors que la variante stricte refuse", () => {
    expect(resolveEstimateEngineVersion({})).toBe(1);
    expect(resolveEstimateEngineVersion({ calc_engine_version: null })).toBe(1);
    expect(resolveEstimateEngineVersion({ calc_engine_version: 3 })).toBe(3);
    expect(() => requireEstimateEngineVersion({})).toThrow();
    expect(requireEstimateEngineVersion({ calc_engine_version: 3 })).toBe(3);
  });
});

describe("ACTUEL — création par téléversement : refus v3 avant dépôt, tâche et inférence", () => {
  it.each(CREATION_MATRIX)(
    "niveau $level, fournisseur $provider, clé $idempotencyKey : 409 nommé, rien n'est écrit ni lancé",
    async ({ level, provider, idempotencyKey }) => {
      const fake = createCreationFake({ version: estimateVersionRow({ calcEngineVersion: 3 }) });
      useFake(fake);

      const response = await postTakeoffJob(await buildCreateRequest({ level, provider, idempotencyKey }));
      const body = (await response.json()) as { ok: boolean; error?: Record<string, unknown> };

      expect(response.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(body.error).toMatchObject(V3_REFUSAL);
      expectNothingStarted(fake);
    }
  );

  it("refuse par le moteur avant le statut : une v3 envoyée reçoit le refus v3, pas le refus de brouillon", async () => {
    const fake = createCreationFake({ version: estimateVersionRow({ calcEngineVersion: 3, status: "sent" }) });
    useFake(fake);

    const response = await postTakeoffJob(
      await buildCreateRequest({ level: "B", provider: "auto", idempotencyKey: null })
    );
    const body = (await response.json()) as { error?: Record<string, unknown> };

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject(V3_REFUSAL);
    expectNothingStarted(fake);
  });

  it("refuse le rejeu d'une clé dont la tâche existante vise une v3, avant de lire le corps", async () => {
    const fake = createCreationFake({
      version: estimateVersionRow({ calcEngineVersion: 3 }),
      existingJob: takeoffJobRow({ status: "pending" }),
    });
    useFake(fake);

    const response = await postTakeoffJob(
      await buildCreateRequest({ level: "B", provider: "auto", idempotencyKey: "m3-cle-rejeu" })
    );
    const body = (await response.json()) as { error?: Record<string, unknown> };

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject(V3_REFUSAL);
    expect(assertTakeoffEnabled).not.toHaveBeenCalled();
    expectNothingStarted(fake);
  });

  // Témoin : le même harnais, avec le seul moteur changé, va jusqu'au dépôt et au lancement.
  // Il prouve que les assertions « rien n'est lancé » ci-dessus ne sont pas vides.
  it.each([
    { engine: 1, level: "A" as const },
    { engine: 2, level: "B" as const },
    { engine: 2, level: "C" as const },
  ])("témoin moteur $engine niveau $level : dépôt, tâche, audit et lancement ont lieu", async ({ engine, level }) => {
    const fake = createCreationFake({ version: estimateVersionRow({ calcEngineVersion: engine }) });
    useFake(fake);

    const response = await postTakeoffJob(await buildCreateRequest({ level, provider: "auto", idempotencyKey: null }));

    expect(response.status).toBe(201);
    expect(fake.storageCalls.filter((call) => call.method === "upload")).toHaveLength(1);
    expect(fake.writesTo("takeoff_jobs")).toHaveLength(1);
    expect(fake.writesTo("audit_logs")).toHaveLength(1);
    expect(getTakeoffExecutionOwner).toHaveBeenCalledTimes(1);
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledTimes(1);
    if (level !== "A") expect(inspectSourceReferencePdf).toHaveBeenCalledTimes(1);
  });
});

describe("ACTUEL — lancement depuis un jeu de plans et source à dupliquer", () => {
  it.each(
    (["B", "C"] as const).flatMap((level) =>
      (["auto", "gemini", "chatgpt"] as const).map((provider) => ({ level, provider }))
    )
  )("jeu de plans niveau $level, fournisseur $provider : 409 nommé sans lire le jeu ni ses fichiers", async ({ level, provider }) => {
    const fake = createSupabaseFake({
      tables: { estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3 }), error: null }) },
    });
    useFake(fake);

    await expect(
      createTakeoffJobFromPlanSet({
        projectId: M3_PROJECT_ID,
        planSetId: M3_PLAN_SET_ID,
        estimateVersionId: M3_VERSION_ID,
        level,
        provider,
      })
    ).rejects.toMatchObject({ status: 409, ...V3_REFUSAL });

    expect(fake.tablesTouched).toEqual(["estimate_versions"]);
    expect(fake.storageCalls).toEqual([]);
    expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
    expect(getTakeoffGeminiDeliveryConfigForTenant).not.toHaveBeenCalled();
    expect(getTakeoffChunkingConfigForTenant).not.toHaveBeenCalled();
    expect(getTakeoffLevelCProcessingConfigForTenant).not.toHaveBeenCalled();
  });

  it("refuse une source v3 avant toute duplication (sa copie garderait le moteur 3)", async () => {
    const fake = createSupabaseFake({
      tables: { estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3, status: "accepted" }), error: null }) },
    });
    useFake(fake);

    await expect(assertTakeoffSourceVersionSupported(M3_VERSION_ID)).rejects.toMatchObject({
      status: 409,
      ...V3_REFUSAL,
    });
    expect(fake.tablesTouched).toEqual(["estimate_versions"]);
  });

  it("témoin : une source moteur 2 non brouillon est acceptée (le statut de la source est libre)", async () => {
    const fake = createSupabaseFake({
      tables: { estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 2, status: "accepted" }), error: null }) },
    });
    useFake(fake);

    await expect(assertTakeoffSourceVersionSupported(M3_VERSION_ID)).resolves.toBeUndefined();
  });
});

describe("ACTUEL — application d'un résultat sur une v3", () => {
  function createApplyFake(input: {
    job: ReturnType<typeof takeoffJobRow>;
    version: ReturnType<typeof estimateVersionRow> | null;
  }) {
    return createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: input.job, error: null }),
        estimate_versions: () => ({ data: input.version, error: null }),
        audit_logs: () => ({ data: null, error: null }),
      },
    });
  }

  it("refuse par son nom avant la prévisualisation, la garde DPGF et la RPC d'application", async () => {
    const fake = createApplyFake({
      job: takeoffJobRow({ status: "completed" }),
      version: estimateVersionRow({ calcEngineVersion: 3 }),
    });
    useFake(fake);

    await expect(
      applyTakeoffJob(M3_JOB_ID, { strategy: "merge", target_section_id: SECTION_ID })
    ).rejects.toMatchObject({ status: 409, code: V3_REFUSAL.code, message: V3_REFUSAL.message });

    expect(fake.rpcCalls).toEqual([]);
    expect(fake.tablesTouched).not.toContain("takeoff_items");
    expect(fake.tablesTouched).not.toContain("estimate_items");
    // L'échec est journalisé en mode non bloquant, avec le code nommé.
    const audits = fake.writesTo("audit_logs").map((query) => query.payload as Record<string, unknown>);
    expect(audits.map((audit) => audit.action)).toEqual(["takeoff.apply.failed"]);
    expect(JSON.stringify(audits[0])).toContain(V3_REFUSAL.code);
  });

  // Écart documenté (server.ts:5450, `if (data && …)`) : si la ligne de version n'est pas
  // lisible, la garde moteur est sautée et l'application continue vers ses autres contrôles.
  // Ici le job est en échec : l'erreur obtenue est le conflit de statut, pas le refus v3.
  it("saute la garde moteur quand la ligne de version n'est pas lisible", async () => {
    const fake = createApplyFake({ job: takeoffJobRow({ status: "failed" }), version: null });
    useFake(fake);

    await expect(
      applyTakeoffJob(M3_JOB_ID, { strategy: "merge", target_section_id: SECTION_ID })
    ).rejects.toMatchObject({ status: 409, code: TakeoffErrorCode.CONFLICT });
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("ACTUEL — reprise d'un job en échec visant une v3 (écart documenté)", () => {
  // La relance et la resoumission ne relisent pas le moteur de la version cible
  // (job-actions-server.ts) ; la route relance ensuite le traitement, donc l'inférence.
  // Ne concerne qu'un éventuel job visant une v3 créé avant la garde de création.
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

  it("la route de relance remet le job en attente et relance le traitement sans lire le moteur", async () => {
    const fake = createRetryFake();
    useFake(fake);

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

  it("la resoumission accepte aussi le job sans lire le moteur", async () => {
    const fake = createRetryFake();
    useFake(fake);

    await expect(resubmitTakeoffJob(M3_JOB_ID)).resolves.toMatchObject({ command: "resubmit", outcome: "applied" });
    expect(fake.tablesTouched).not.toContain("estimate_versions");
  });
});

describe("FUTUR — attend M2 (contrat et writer v3) : critères non normatifs", () => {
  // Aucun de ces critères ne doit devenir un test de réussite avant un diff de contrat M2
  // accepté. Les interfaces de référence restent : POST /api/takeoff/jobs (multipart),
  // l'action affaire de lancement depuis un jeu, POST /api/takeoff/jobs/{jobId}/apply.
  it.todo("tant que la capacité complète du writer v3 n'est pas disponible, chaque refus ACTUEL ci-dessus reste vert");
  it.todo("une v3 créée par la politique normale (sans ligne de politique) est admise seulement quand la capacité du writer est déclarée, et les contrôles au commit restent actifs");
  it.todo("la duplication d'une source v3 garde le moteur 3 ; aucun repli vers un devis moteur 2");
  it.todo("relance et resoumission appliquent la même règle d'admission que la création");
  it.todo("apply v3 : écrit unit_code, pricing_status, quantités et provenance par le référentiel partagé, sans recalcul historique");
  it.todo("apply v3 : snapshot appliqué, mapping item→ligne et journal atomiques ; un rejeu n'ajoute aucun doublon");
  it.todo("apply v3 : une concurrence de révision est refusée sans écriture partielle ; un refus d'accès n'écrit rien");
  it.todo("apply v3 : montants calculés côté moteur/SQL, jamais fournis par le client ou le fournisseur ; heures sans double multiplication par la quantité");
  it.todo("régression : les parcours v1/v2, les devis émis et leurs montants restent identiques");
});
