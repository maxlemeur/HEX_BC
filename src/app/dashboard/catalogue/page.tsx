import { DpgfStepper } from "@/components/DpgfStepper";
import { CatalogueManager } from "@/components/catalogue/CatalogueManager";

export default function DashboardCataloguePage() {
  return (
    <div className="animate-fade-in">
      <DpgfStepper />
      <div className="page-header">
        <h1 className="page-title">Catalogue</h1>
        <p className="page-description">
          Gerez les articles du catalogue et liez les lignes importees aux produits.
        </p>
      </div>

      <CatalogueManager />
    </div>
  );
}
