import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ImportFlowLinesPreview } from "@/app/dashboard/affaires/_actions/import-flow";
import { ImportLinesPreview } from "./ImportLinesPreview";

// Lot 2, sous-lot 2.8 (D11, E4): what the preview of an OPTIMA import into a v3 tells before confirmation.
function v3Preview(overrides: Partial<ImportFlowLinesPreview> = {}): ImportFlowLinesPreview {
  return {
    validLineCount: 1,
    ignoredParameterRows: 1,
    invalidLines: [],
    invalidLineCount: 0,
    hours: {
      linesWithHours: 1,
      convertedLines: 1,
      totalLineHours: 39.82,
      lines: [{ rowIndex: 2, title: "O1", quantity: 20, hoursPerUnit: 1.991, lineHours: 39.82 }],
    },
    workbookParameters: { rowIndex: 1, coeffFo: 1.3, coeffMo: 1.3, hourlyRateCents: 4000, majorationCoefficient: 1 },
    versionMarginMultiplier: 1,
    laborRoles: [
      { id: "role-40", name: "Tuyauteur", hourlyRateCents: 4000 },
      { id: "role-45", name: "Chef d’équipe", hourlyRateCents: 4500 },
    ],
    laborRole: { status: "resolved", roleId: "role-40", matchingRoleIds: [] },
    unitPriceChecks: { checked: 1, toleranceCents: 0.5, outOfTolerance: [] },
    perUnitDurationsAsLineHours: [],
    engine: 3,
    saleCoefficients: { fo: 1.3, mo: 1.3, source: "workbook" },
    ...overrides,
  } as ImportFlowLinesPreview;
}

function renderPreview(preview: ImportFlowLinesPreview, selectedLaborRoleId?: string | null) {
  return render(
    <ImportLinesPreview
      preview={preview}
      isLoading={false}
      error={null}
      selectedLaborRoleId={selectedLaborRoleId}
      onLaborRoleChange={vi.fn()}
      onSaleCoefficientsChange={vi.fn()}
      onRetry={vi.fn()}
    />
  );
}

describe("2.8 import preview into a v3", () => {
  it("proposes the workbook coefficients and states the Prix Unitaire self-check", () => {
    renderPreview(v3Preview());

    expect(screen.getByText("Coefficients du classeur proposés : FO 1,3 · MO 1,3")).toBeTruthy();
    expect(screen.getByText("Aucun écart supérieur à 0,5 c avec « Prix Unitaire »")).toBeTruthy();
    expect(screen.getByText(/^Provision FO 1,01 ajoutée à la création \(lignes sans type FO\)/)).toBeTruthy();
    expect(screen.getByText("Heures MO : heures par unité (h/u)")).toBeTruthy();
    expect(screen.queryByText(/taux horaire du classeur .* rôle choisi/i)).toBeNull();
  });

  it("signals a chosen role whose hourly rate differs from the workbook's", () => {
    renderPreview(v3Preview(), "role-45");

    expect(
      screen.getByText("Taux horaire du classeur 40,00 €/h, rôle choisi 45,00 €/h : la MO différera du classeur.")
    ).toBeTruthy();
  });
});
