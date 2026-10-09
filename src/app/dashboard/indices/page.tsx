import { IndicesManager } from "@/components/catalogue/IndicesManager";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardIndicesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Tarifs", href: "/dashboard/tarifs" }, { label: "Indices" }]}
        title="Indices matière"
        description="Créez, modifiez et mettez à jour en masse les indices de révision des prix matière."
      />

      <IndicesManager />
    </div>
  );
}
