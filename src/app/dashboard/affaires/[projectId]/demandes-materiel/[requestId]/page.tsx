import { notFound } from "next/navigation";

import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";

import { loadMaterialRequestAffaire } from "../_lib/affaire";
import { UUID_PATTERN as UUID } from "@/lib/value-guards";

type Props = {
  params: Promise<{ projectId: string; requestId: string }>;
};

export default async function AffaireMaterialRequestPage({ params }: Props) {
  const { projectId, requestId } = await params;
  if (!UUID.test(requestId)) notFound();
  const project = await loadMaterialRequestAffaire(projectId);
  const listHref = `/dashboard/affaires/${projectId}/demandes-materiel`;

  return (
    <div className="material-request-page">
      <MaterialRequestEditor
        projectId={projectId}
        requestId={requestId}
        affaireName={project.name}
        canEditCatalogue={project.canEditCatalogue}
        canCreateSupplyType={project.canCreateSupplyType}
        pageHeader={{
          breadcrumbs: [
            { label: "Affaires", href: "/dashboard/affaires" },
            { label: project.name, href: `/dashboard/affaires/${projectId}` },
            { label: "Achats", href: listHref },
            { label: "Demande" },
          ],
          back: { href: listHref, label: "Retour aux achats" },
        }}
      />
    </div>
  );
}
