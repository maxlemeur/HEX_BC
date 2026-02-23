import { DpgfStepper } from "@/components/DpgfStepper";
import { MappingWizard } from "@/components/mappings/MappingWizard";

export default function DashboardMappingsPage() {
  return (
    <div className="animate-fade-in">
      <DpgfStepper />
      <div className="page-header">
        <h1 className="page-title">Mapping DPGF</h1>
        <p className="page-description">
          Associez les colonnes de votre fichier aux champs metier, puis validez le mapping.
        </p>
      </div>

      <MappingWizard />
    </div>
  );
}
