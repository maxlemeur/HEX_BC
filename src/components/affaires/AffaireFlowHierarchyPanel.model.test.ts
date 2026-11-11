import { describe, expect, it } from "vitest";

import { isDpgfSourceImported } from "@/components/affaires/AffaireFlowHierarchyPanel.model";
import type { AffaireHubDpgfSourceResult } from "@/lib/affaires/server";

// TI-670. The hub reads the newest `dpgf_imports` row of the affaire (`fetchAffaireHubDpgfSourceWithContext`
// orders by `created_at desc limit 1`), so a replaced DPGF is described by its latest import. The table below is
// every state that row can be in (`dpgf_imports.status` check constraint: pending, parsing, completed, failed),
// plus the absence of any import, and the badge each one must show on the DPGF card.
function source(importStatus: string, overrides: Partial<NonNullable<AffaireHubDpgfSourceResult>> = {}) {
  return {
    importId: "11111111-1111-4111-8111-111111111111", filename: "dpgf.xlsx", sourceFormat: "xlsx", importStatus,
    mappingStatus: null, importedAt: "2026-11-11T10:00:00.000Z", mappingUpdatedAt: null, parseMode: null, rowCount: 12,
    mappedRowCount: 0, ...overrides,
  } as NonNullable<AffaireHubDpgfSourceResult>;
}

describe("isDpgfSourceImported, the « Importée » badge of the DPGF card", () => {
  it.each([
    ["no import at all: a document only classified DPGF", null, false],
    ["import recorded, not started", source("pending"), false],
    ["import in progress", source("parsing"), false],
    ["import failed", source("failed"), false],
    ["import completed", source("completed"), true],
    ["import completed, mapping still to validate", source("completed", { mappingStatus: "pending", mappedRowCount: 0 }), true],
    ["replaced by a newer import that failed", source("failed", { importedAt: "2026-11-11T12:00:00.000Z" }), false],
    ["replaced by a newer import that completed", source("completed", { importedAt: "2026-11-11T12:00:00.000Z" }), true],
    ["a status the constraint does not know", source("unknown"), false],
  ] as const)("%s", (_state, dpgfSource, imported) => {
    expect(isDpgfSourceImported(dpgfSource)).toBe(imported);
  });
});
