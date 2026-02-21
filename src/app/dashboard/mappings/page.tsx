import { MappingWizard } from "@/components/mappings/MappingWizard";

export default function DashboardMappingsPage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Mappings DPGF</h1>
        <p className="page-description">
          Mappez les colonnes importees, validez les champs requis et detectez les doublons.
        </p>
      </div>

      <MappingWizard />
    </div>
  );
}
