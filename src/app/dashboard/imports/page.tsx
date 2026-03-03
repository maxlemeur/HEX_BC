import { DpgfStepper } from "@/components/DpgfStepper";
import { ImportWizard } from "@/components/imports/ImportWizard";

export default function DashboardImportsPage() {
  return (
    <div className="animate-fade-in">
      <DpgfStepper />
      <div className="page-header">
        <h1 className="page-title">Import DPGF</h1>
        <p className="page-description">
          Importez votre DPGF (Décomposition du Prix Global et Forfaitaire) au format CSV ou Excel pour démarrer le chiffrage.
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
