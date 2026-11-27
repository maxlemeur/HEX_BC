import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { canAddToCatalogue } from "@/lib/catalogue/access";

import { SupplierBasePreviewForm } from "./supplier-base-preview-form";

export default async function ImportSupplierBasePage() {
  const { tenantRole } = await getAuthenticatedTenantContext();
  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Produits", href: "/dashboard/products" },
          { label: "Importer une base fournisseurs" },
        ]}
        title="Importer une base fournisseurs"
        description="Prévisualisez les rapprochements avec le catalogue fournisseur par fournisseur. La confirmation sera disponible à la prochaine étape."
      />
      {canAddToCatalogue(tenantRole)
        ? <SupplierBasePreviewForm />
        : <Alert variant="warning">Seuls les administrateurs et les ingénieurs peuvent préparer cet import.</Alert>}
    </div>
  );
}
