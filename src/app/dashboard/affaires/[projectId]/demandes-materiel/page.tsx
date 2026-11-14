import { PageHeader } from "@/components/layout/page-header";
import { AffaireSupplyCost } from "@/components/material-requests/AffaireSupplyCost";
import { MaterialRequestsList } from "@/components/material-requests/MaterialRequestsList";

import { loadMaterialRequestAffaire } from "./_lib/affaire";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AffaireMaterialRequestsPage({ params }: Props) {
  const { projectId } = await params;
  const project = await loadMaterialRequestAffaire(projectId);

  return (
    <>
      <PageHeader
        title="Achats"
        description="Les demandes de matériel des techniciens, de l’original jusqu’à la commande, et ce que les fournitures coûtent à l’affaire."
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Achats" },
        ]}
      />

      <div className="space-y-8">
        <MaterialRequestsList projectId={projectId} />
        <AffaireSupplyCost projectId={projectId} />
      </div>
    </>
  );
}
