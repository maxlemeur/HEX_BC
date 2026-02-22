import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSource(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("EstimateEditorTable supplier comparison regressions", () => {
  const tableSource = readSource(
    "src/components/estimates/EstimateEditorTable.tsx"
  );
  const rowSource = readSource(
    "src/components/estimates/components/EstimateEditorRow.tsx"
  );
  const panelSource = readSource(
    "src/components/estimates/SupplierComparisonPanel.tsx"
  );

  it("keeps row context action and fallback button for supplier comparison", () => {
    expect(tableSource).toContain("Comparer fournisseurs");
    expect(rowSource).toContain("onContextMenu={handleLineContextMenu}");
    expect(rowSource).toContain("onOpenSupplierComparisonPanel(item.id)");
  });

  it("keeps mismatch badge logic tied to selected and best supplier price ids", () => {
    expect(tableSource).toMatch(
      /bestSupplierPriceId !== null[\s\S]*\(item\.selected_supplier_price_id \?\? null\) !== bestSupplierPriceId/
    );
    expect(rowSource).toContain("Meilleur prix fournisseur disponible");
  });

  it("renders SupplierComparisonPanel states and secure external links", () => {
    expect(tableSource).toContain("<SupplierComparisonPanel");
    expect(panelSource).toContain("Chargement des alternatives fournisseurs...");
    expect(panelSource).toContain("Aucune alternative fournisseur.");
    expect(panelSource).toContain("estimate-supplier-comparison-state--error");
    expect(panelSource).toContain("target=\"_blank\"");
    expect(panelSource).toContain("rel=\"noreferrer noopener\"");
  });
});
