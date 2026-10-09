import { DpgfStepper } from "@/components/DpgfStepper";
import { CatalogueManager } from "@/components/catalogue/CatalogueManager";
import { PageHeader } from "@/components/layout/page-header";

export default function DashboardCataloguePage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Catalogue" },
        ]}
        title="Catalogue"
        description="Gérez les articles du catalogue et liez les lignes importées aux produits."
      />
      <DpgfStepper />

      <CatalogueManager />
    </div>
  );
}
