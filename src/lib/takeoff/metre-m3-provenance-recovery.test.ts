import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot M3 (métré) — reprise d'une synchronisation intake partiellement échouée.
// ACTUEL : caractérisation à 354c18a ; ce test ne fixe aucune règle à venir.

vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: vi.fn(),
}));

import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  createIntakeFake,
  intakeDocument,
  M3_PROJECT_ID,
  M3_TENANT_ID,
} from "@/lib/takeoff/metre-m3.test-utils";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTakeoffEnabled).mockResolvedValue(true);
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
    for (const [path, blob] of first.planObjects) replay.planObjects.set(path, blob);
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
