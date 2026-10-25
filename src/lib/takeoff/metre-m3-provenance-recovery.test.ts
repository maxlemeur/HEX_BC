import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot M3 (métré) — traçabilité des quantités, provenance et reprise.
// ACTUEL : caractérisation à 354c18a de la correction humaine, de la relance, de la reprise
// d'une synchronisation partielle et de la lecture des unités du métré par le référentiel
// partagé v3. Aucun de ces tests ne fixe une règle à venir.
// FUTUR : `it.todo` seulement. Les décisions ouvertes de la revue M1/M2 (unité non résolue,
// prix/temps absents, MO legacy, identité historique) ne reçoivent aucun test normatif.

vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  isTakeoffEnabled: vi.fn(),
}));

import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertTakeoffEnabled, isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  authenticatedContext,
  createIntakeFake,
  createSupabaseFake,
  intakeDocument,
  M3_ITEM_ID,
  M3_JOB_ID,
  M3_PROJECT_ID,
  M3_TENANT_ID,
  M3_USER_ID,
  takeoffItemRow,
  takeoffJobRow,
  type FakeQuery,
  type SupabaseFake,
} from "@/lib/takeoff/metre-m3.test-utils";
import { batchUpdateTakeoffItems, retryTakeoffJob } from "@/lib/takeoff/server";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

const ITEM_UPDATED_AT = "2026-01-01T00:02:00.000Z";

function useFake(fake: SupabaseFake) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
}

function createCorrectionFake(input: {
  item?: ReturnType<typeof takeoffItemRow>;
  auditError?: { code: string; message: string } | null;
}) {
  const item = input.item ?? takeoffItemRow();
  return createSupabaseFake({
    tables: {
      takeoff_jobs: () => ({ data: takeoffJobRow({ status: "completed", error_code: null, error_message: null }), error: null }),
      takeoff_items: (query: FakeQuery) =>
        query.operation === "update"
          ? { data: { ...item, ...(query.payload as Record<string, unknown>) }, error: null }
          : { data: item, error: null },
      audit_logs: () => ({ data: null, error: input.auditError ?? null }),
    },
  });
}

function auditPayloads(fake: SupabaseFake) {
  return fake.writesTo("audit_logs").map((query) => query.payload as Record<string, unknown>);
}

function correction(fields: Record<string, unknown>) {
  return { items: [{ item_id: M3_ITEM_ID, updated_at: ITEM_UPDATED_AT, fields }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(isTakeoffEnabled).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.mocked(console.error).mockRestore();
});

describe("ACTUEL — correction humaine d'un item de métré", () => {
  it("écrase quantité et unité sur l'item, sans toucher aux métadonnées de normalisation", async () => {
    const fake = createCorrectionFake({});
    useFake(fake);

    const response = await batchUpdateTakeoffItems(M3_JOB_ID, correction({ quantity: 15, unit: "m2" }));

    expect(response).toMatchObject({ succeeded: 1, failed: 0 });
    const [update] = fake.writesTo("takeoff_items");
    expect(update?.payload).toMatchObject({ quantity: 15, unit: "m2" });
    // L'unité brute de l'IA survit dans metadata.original_unit, mais metadata.normalized_unit
    // reste « ml » alors que l'unité de l'item vaut désormais « m2 ».
    expect(update?.payload).not.toHaveProperty("metadata");
    expect(response.results[0]?.item?.metadata).toMatchObject({ original_unit: "m.l", normalized_unit: "ml" });
    // La révision attendue est contrôlée au moment de l'écriture (OCC).
    expect(update?.filters).toContainEqual({ kind: "eq", column: "updated_at", value: ITEM_UPDATED_AT });
  });

  it("journalise chaque champ modifié avec ses valeurs avant et après", async () => {
    const fake = createCorrectionFake({});
    useFake(fake);

    await batchUpdateTakeoffItems(M3_JOB_ID, correction({ quantity: 15, unit: "m2" }));

    const audits = auditPayloads(fake);
    expect(audits.map((audit) => audit.action)).toEqual(["takeoff.item.modified", "takeoff.item.modified"]);
    expect(JSON.stringify(audits)).toContain('"previous_value":12.5');
    expect(JSON.stringify(audits)).toContain('"next_value":15');
  });

  // Écart documenté : l'audit est non bloquant (server.ts, mode "non-blocking"). Si son
  // écriture échoue, la correction reste enregistrée et la quantité d'origine ne figure plus
  // sur l'item. L'extraction initiale reste dans takeoff_results.extracted_json/raw_response,
  // mais aucun lien stable item → entrée brute n'existe hors niveau B (table_index/row_index).
  it("garde la correction quand l'audit échoue : la valeur précédente n'est plus tracée sur l'item", async () => {
    const fake = createCorrectionFake({ auditError: { code: "42501", message: "audit refusé (simulé)" } });
    useFake(fake);

    const response = await batchUpdateTakeoffItems(M3_JOB_ID, correction({ quantity: 15 }));

    expect(response).toMatchObject({ succeeded: 1, failed: 0 });
    expect(response.results[0]?.item?.quantity).toBe(15);
    expect(JSON.stringify(response.results[0]?.item)).not.toContain("12.5");
    expect(fake.writesTo("audit_logs")).toHaveLength(1);
  });

  it("invalide la vérification humaine quand un contenu vérifié est modifié", async () => {
    const fake = createCorrectionFake({
      item: takeoffItemRow({ is_verified: true, verified_at: "2026-01-01T00:03:00.000Z", verified_by: M3_USER_ID }),
    });
    useFake(fake);

    await batchUpdateTakeoffItems(M3_JOB_ID, correction({ quantity: 15 }));

    const [update] = fake.writesTo("takeoff_items");
    expect(update?.payload).toMatchObject({ quantity: 15, is_verified: false, verified_at: null, verified_by: null });
    expect(JSON.stringify(auditPayloads(fake))).toContain('"field":"is_verified"');
  });

  it("ne permet pas de corriger le fichier source d'un item (seule la page est modifiable)", async () => {
    const fake = createCorrectionFake({});
    useFake(fake);

    await expect(
      batchUpdateTakeoffItems(M3_JOB_ID, correction({ source_file_name: "Plan R+1.pdf" }))
    ).rejects.toMatchObject({ status: 422 });
    expect(fake.writesTo("takeoff_items")).toEqual([]);
  });
});

describe("ACTUEL — relance après échec : métriques de la tentative précédente", () => {
  it("efface coût, jetons et durée de la tentative précédente sur le job ; l'audit ne les reprend pas", async () => {
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: (query: FakeQuery) =>
          query.operation === "update"
            ? { data: takeoffJobRow({ ...(query.payload as Record<string, unknown>) }), error: null }
            : { data: takeoffJobRow({ status: "failed", cost_cents: 7, token_count: 1200 }), error: null },
        audit_logs: () => ({ data: null, error: null }),
      },
    });
    useFake(fake);

    await expect(retryTakeoffJob(M3_JOB_ID)).resolves.toMatchObject({ command: "retry", outcome: "applied" });

    const [update] = fake.writesTo("takeoff_jobs");
    expect(update?.payload).toMatchObject({
      status: "pending",
      retry_count: 1,
      cost_cents: null,
      token_count: null,
      duration_ms: null,
      error_code: null,
      error_message: null,
    });
    const audits = auditPayloads(fake);
    expect(audits.map((audit) => audit.action)).toEqual(["takeoff.job.retried"]);
    expect(JSON.stringify(audits[0])).toContain('"from_attempt":1');
    expect(JSON.stringify(audits[0])).not.toContain("cost");
  });
});

describe("ACTUEL — reprise d'une synchronisation intake partiellement échouée", () => {
  it("signale le document en échec, garde les autres, puis ne synchronise au rejeu que le manquant", async () => {
    const failingPath = intakeDocument({ id: "doc-r-moins-1", fileName: "Plan R-1.pdf" }).storage_path;
    const documents = [
      intakeDocument({ id: "doc-r-plus-1", fileName: "Plan R+1.pdf" }),
      intakeDocument({ id: "doc-r-moins-1", fileName: "Plan R-1.pdf" }),
    ];
    const first = createIntakeFake({ failingDownloads: new Set([failingPath]) });

    await expect(
      syncTakeoffPlanSetFromAffaireIntake({
        supabase: first.fake.client as never,
        project: { id: M3_PROJECT_ID, tenant_id: M3_TENANT_ID },
        documents,
      })
    ).rejects.toThrow("doc-r-moins-1");
    expect(first.planFiles.map((row) => (row.metadata as Record<string, unknown>).intake_document_id)).toEqual([
      "doc-r-plus-1",
    ]);

    // Rejeu sur le même état, téléchargement rétabli.
    const replay = createIntakeFake();
    replay.planSets.push(...first.planSets);
    replay.planFiles.push(...first.planFiles);
    const result = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: replay.fake.client as never,
      project: { id: M3_PROJECT_ID, tenant_id: M3_TENANT_ID },
      documents,
    });

    expect(result).toEqual({ syncedDocumentCount: 1, removedDocumentCount: 0 });
    expect(replay.planSets).toHaveLength(1);
    expect(replay.planFiles.map((row) => (row.metadata as Record<string, unknown>).intake_document_id)).toEqual([
      "doc-r-plus-1",
      "doc-r-moins-1",
    ]);
    // Les deux plans repris portent toujours le même file_name nettoyé.
    expect(new Set(replay.planFiles.map((row) => row.file_name))).toEqual(new Set(["Plan-R-1.pdf"]));
  });
});

describe("ACTUEL — unités du métré lues par le référentiel partagé v3 (normalizeMeasurementUnit)", () => {
  // Colonne « métré » : copie documentaire du normaliseur privé du métré (processor.ts,
  // UNIT_SYNONYMS et normalizeTakeoffUnit), non exporté donc non exécuté ici. Seule la lecture
  // v3 est exécutée. Ce tableau expose les écarts à trancher par M2 ; il n'en tranche aucun.
  it.each([
    { brute: "ens", metre: "forfait", v3DepuisMetre: "fft", v3DepuisBrute: "ens" },
    { brute: "ensemble", metre: "forfait", v3DepuisMetre: "fft", v3DepuisBrute: "ens" },
    { brute: "lot", metre: "forfait", v3DepuisMetre: "fft", v3DepuisBrute: null },
    { brute: "m", metre: "m", v3DepuisMetre: "ml", v3DepuisBrute: "ml" },
    { brute: "sqm", metre: "m2", v3DepuisMetre: "m2", v3DepuisBrute: null },
    { brute: "unit", metre: "u", v3DepuisMetre: "u", v3DepuisBrute: null },
    { brute: "ea", metre: "u", v3DepuisMetre: "u", v3DepuisBrute: null },
    { brute: "m2j", metre: "m2j", v3DepuisMetre: null, v3DepuisBrute: null },
    { brute: "", metre: "u", v3DepuisMetre: "u", v3DepuisBrute: null },
  ])("brute « $brute » → métré « $metre » → v3 $v3DepuisMetre (depuis la brute : $v3DepuisBrute)", ({ brute, metre, v3DepuisMetre, v3DepuisBrute }) => {
    expect(normalizeMeasurementUnit(metre).unitCode).toBe(v3DepuisMetre);
    expect(normalizeMeasurementUnit(brute).unitCode).toBe(v3DepuisBrute);
  });

  it("lit « PM » comme un statut de chiffrage v3, là où le métré le garde comme unité inconnue « pm »", () => {
    expect(normalizeMeasurementUnit("PM")).toEqual({ unitCode: null, pricingStatus: "for_memory" });
    expect(normalizeMeasurementUnit("pm")).toEqual({ unitCode: null, pricingStatus: "for_memory" });
  });
});

describe("FUTUR — traçabilité et reprise (propositions, aucune règle figée)", () => {
  it.todo("hors M1/M2 : la correction et son événement sont écrits dans une même transaction, avec révision attendue et clé de reprise ; un audit fail-hard après l'update ne suffit pas");
  it.todo("chaque item garde un lien stable vers son entrée d'extraction brute, à tous les niveaux");
  it.todo("une correction d'unité tient à jour, ou invalide explicitement, les métadonnées de normalisation");
  it.todo("une relance conserve le coût et les jetons des tentatives précédentes dans un journal de tentatives");
  it.todo("M1b : le fichier de provenance connu par le système (page → fichier) n'est pas remplacé en silence par le source_file déclaré par l'IA ; la valeur IA reste une preuve brute");
  it.todo("M2, décision ouverte : unité non résolue ou ambiguë (m2j, lot, ens/fft, vide) — refus de la ligne avec diagnostic, sans écriture partielle, est la proposition à approuver");
  it.todo("M2, décision ouverte : prix ou temps absents — distinguer extraction terminée et ligne prête au chiffrage, sans zéro économique inventé");
});
