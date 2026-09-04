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
  const lineRowSource = readSource(
    "src/components/estimates/components/estimate-editor-row/LineRow.tsx"
  );
  const panelSource = readSource(
    "src/components/estimates/SupplierComparisonPanel.tsx"
  );
  // L'entree de menu « Comparer fournisseurs » a quitte EstimateEditorTable.tsx
  // lors de la decomposition de la table (REF-002) : elle vit desormais dans le
  // menu contextuel de ligne. Le garde pointait toujours l'ancien fichier et
  // etait rouge depuis, sans que la fonctionnalite ait bouge.
  const lineContextMenuSource = readSource(
    "src/components/estimates/components/estimate-editor-table/EstimateEditorTableLineContextMenu.tsx"
  );

  it("keeps row context action and fallback button for supplier comparison", () => {
    expect(tableSource).toContain("<EstimateEditorTableLineContextMenu");
    expect(lineContextMenuSource).toContain("Comparer les fournisseurs");
    expect(lineRowSource).toContain("onContextMenu={handleLineContextMenu}");
    expect(lineRowSource).toContain("onOpenSupplierComparisonPanel(item.id)");
  });

  it("keeps mismatch badge logic tied to selected and best supplier price ids", () => {
    expect(tableSource).toMatch(
      /bestSupplierPriceId !== null[\s\S]*\(item\.selected_supplier_price_id \?\? null\) !== bestSupplierPriceId/
    );
    expect(lineRowSource).toContain("Meilleur prix fournisseur disponible");
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
