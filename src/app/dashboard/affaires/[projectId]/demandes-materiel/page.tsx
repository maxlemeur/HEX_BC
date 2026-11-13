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
        title="Demandes de matériel"
        description="Ce que les techniciens demandent au bureau, recopié en lignes claires avec l’original à côté."
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Demandes de matériel" },
        ]}
      />

      <div className="space-y-8">
        <MaterialRequestsList projectId={projectId} />
        <AffaireSupplyCost projectId={projectId} />
      </div>
    </>
  );
}
