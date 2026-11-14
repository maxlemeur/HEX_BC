import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";

import { loadMaterialRequestAffaire } from "../_lib/affaire";

type Props = {
  params: Promise<{ projectId: string; requestId: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AffaireMaterialRequestPage({ params }: Props) {
  const { projectId, requestId } = await params;
  if (!UUID.test(requestId)) notFound();
  const project = await loadMaterialRequestAffaire(projectId);
  const listHref = `/dashboard/affaires/${projectId}/demandes-materiel`;

  return (
    <div className="material-request-page">
      <PageHeader
        className="mb-2 sm:mb-2"
        title="Demande de matériel"
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Achats", href: listHref },
          { label: "Demande" },
        ]}
        back={{ href: listHref, label: "Retour aux achats" }}
      />

      <MaterialRequestEditor
        projectId={projectId}
        requestId={requestId}
        affaireName={project.name}
        canEditCatalogue={project.canEditCatalogue}
      />
    </div>
  );
}
