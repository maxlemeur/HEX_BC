import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { IndicesManager } from "@/components/catalogue/IndicesManager";

export default function DashboardIndicesPage() {
  return (
    <div className="animate-fade-in">
      <HubBreadcrumb hubHref="/dashboard/tarifs" hubLabel="Tarifs" currentLabel="Indices" />
      <div className="page-header">
        <h1 className="page-title">Indices matiere</h1>
        <p className="page-description">
          CRUD des indices matiere et operation bulk upsert pour mises a jour volumineuses.
        </p>
      </div>

      <IndicesManager />
    </div>
  );
}
