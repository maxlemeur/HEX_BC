import { StrictMode, useEffect, useRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { EstimateEditorTable } from "../../src/components/estimates/EstimateEditorTable";
import { ToastProvider, useToast } from "../../src/components/ui-legacy/Toast";

type TableProps = ComponentProps<typeof EstimateEditorTable>;
const noop = () => {};
const done = async () => {};
const item = {
  id: "11111111-1111-4111-8111-111111111111", version_id: "22222222-2222-4222-8222-222222222222",
  parent_id: null, item_type: "line", title: "Tube cuivre", description: "u", quantity: 3,
  unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1,
  k_mo: 1, pu_ht_cents: 1000, line_total_ht_cents: 3000, position: 0,
  labor_role_id: null, category_id: null, supply_type_id: null, selected_supplier_price_id: null,
  h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
  h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
  created_at: "2026-01-01T00:00:00Z",
} as TableProps["items"][number];

function Fixture() {
  const toast = useToast();
  const ids = useRef<string[]>([]);
  useEffect(() => {
    const notify = () => toast.error({ title: "Notification pendant la comparaison", durationMs: 0 });
    window.addEventListener("fixture-notification", notify);
    return () => window.removeEventListener("fixture-notification", notify);
  }, [toast]);
  return <main className="p-4">
    <h1>Validation locale du tableau et des notifications</h1>
    <button className="btn btn-primary bg-red-700 text-white" data-testid="cascade-button" onClick={() => {
      ids.current = Array.from({ length: 5 }, (_, index) => toast.info({ title: `Notification ${index + 1}`, durationMs: index < 3 ? 60000 : 1500 }));
    }}>Rafale</button>
    <button onClick={() => toast.dismiss(ids.current[4])}>Retirer en attente</button>
    <button onClick={() => toast.dismiss(ids.current[0])}>Retirer première</button>
    <button onClick={() => toast.error({ title: "Échec de sauvegarde", description: "La saisie est conservée.", durationMs: 2000 })}>Erreur</button>
    <button onClick={() => toast.success({ title: "Devis enregistré", durationMs: 1000 })}>Succès bref</button>
    <EstimateEditorTable versionId={item.version_id} items={[item]} categories={[]} supplyTypes={[]}
      laborRoles={[]} suggestionRules={[]} detectedOutlierFlagsByItemId={{}} dismissedOutlierFlagsByItemId={{}}
      outlierActionPendingByItemId={{}} outlierDetectionMethod="zscore" outlierThreshold={3}
      qualityFlagsByItemId={{}} qualityCounts={{ linesCount: 1, linesWithAnomaliesCount: 0, totalFlagsCount: 0, byFlag: {} } as TableProps["qualityCounts"]}
      qualityFilter="all_lines" marginMultiplier={1} discountCents={0} taxRateBp={2000}
      sectionCalculation={{ marginMode: "fixed", marginTiers: [], globalCoefficient: 1, discountMode: "simple", discountStepsBp: [], calcEngineVersion: 1 }}
      laborRateById={new Map()} isReadOnly={false} onQualityFilterChange={noop} onOutlierDetectionMethodChange={noop}
      onOutlierThresholdChange={noop} onToggleOutlierDismiss={noop} onAddSection={noop} onAddLine={noop}
      onDeleteItem={noop} onPatchItem={noop} onApplyBulkMajoration={done} onBulkDeleteLines={done}
      onBulkMoveLines={done} onBulkSetCategory={done} onBulkSetLaborRole={done} onInsertAssembly={done}
      onInsertTemplate={done} onPasteRows={done} onUndo={done} onRedo={done} canUndo={false} canRedo={false}
      isUndoRedoBusy={false} bulkSuggestionEligibleCount={0} supplierPreselectionEligibleCount={0}
      onOpenBulkSuggestDialog={noop} onOpenSupplierPreselectionDialog={noop} onReorder={noop} onMoveItem={noop} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ToastProvider><Fixture /></ToastProvider></StrictMode>);
