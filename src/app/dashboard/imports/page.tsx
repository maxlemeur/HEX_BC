import { DpgfStepper } from "@/components/DpgfStepper";
import { ImportWizard } from "@/components/imports/ImportWizard";

export default function DashboardImportsPage() {
  return (
    <div className="animate-fade-in">
      <DpgfStepper />
      <div className="page-header">
        <h1 className="page-title">Import DPGF</h1>
        <p className="page-description">
          Décomposition du Prix Global et Forfaitaire — CSV, XLSX ou XLS.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
