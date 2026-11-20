import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot M3 (métré) — matrice d'admission du moteur 3, basculée par M2 v0.1.
// Avant M2, chaque entrée du métré refusait une v3 par son nom (TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED).
// M2 ouvre l'admission : le lancement depuis un jeu de plans et l'application suivent
// pour une v3 exactement le chemin d'une v2. L'écriture des lignes v3 (unités du référentiel,
// statuts, provenance, montants du moteur, rejeu, refus nommés) est prouvée en base par
// supabase/tests/database/takeoff-apply-engine-v3.test.sql ; la traduction des refus SQL en
// erreurs API par server.apply.test.ts.

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/preparation-server", () => ({
  assertConfirmedTakeoffPreparation: vi.fn(),
}));

import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffChunkingConfigForTenant: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

// Fournisseur simulé : aucun magasin ChatGPT local, aucun hôte, aucune inférence.
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getConfirmedTakeoffExecutionOwner: vi.fn() };
});

import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
  getTakeoffLowConfidenceThresholdForTenant,
} from "@/lib/takeoff/feature-flags";
import {
  applyTakeoffJob,
  createTakeoffJobFromPlanSet,
} from "@/lib/takeoff/server";
import {
  authenticatedContext,
  createSupabaseFake,
  estimateVersionRow,
  M3_JOB_ID,
  M3_PLAN_SET_ID,
  M3_PROJECT_ID,
  M3_VERSION_ID,
  takeoffJobRow,
  type SupabaseFake,
} from "@/lib/takeoff/metre-m3.test-utils";

const SECTION_ID = "99999999-9999-4999-8999-999999999999";

function installFake(fake: SupabaseFake) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
}

function mockDefaults() {
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.6 as never);
  vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:55555555-5555-4555-8555-555555555555" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(confirmedPreparationFixture());
  mockDefaults();
});

describe("lancement depuis un jeu de plans", () => {
  it("garde le refus de brouillon : une v3 acceptée n'est pas une cible", async () => {
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: null, error: null }),
        estimate_versions: () => ({ data: estimateVersionRow({ calcEngineVersion: 3, status: "accepted" }), error: null }),
      },
    });
    installFake(fake);

    await expect(
      createTakeoffJobFromPlanSet({
        projectId: M3_PROJECT_ID,
        planSetId: M3_PLAN_SET_ID,
        estimateVersionId: M3_VERSION_ID,
        level: "C",
        provider: "chatgpt",
      })
    ).rejects.toMatchObject({ status: 403, code: "READ_ONLY" });
    expect(fake.tablesTouched).toEqual(["takeoff_jobs", "estimate_versions"]);
    expect(getConfirmedTakeoffExecutionOwner).not.toHaveBeenCalled();
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
