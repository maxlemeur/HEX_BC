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
    <>
      <PageHeader
        title="Demande de matériel"
        description="L’original d’un côté, sa réécriture de l’autre. Les cases en jaune sont à compléter ou à vérifier ; rien n’est validé sans vous."
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Demandes de matériel", href: listHref },
          { label: "Demande" },
        ]}
        back={{ href: listHref, label: "Retour aux demandes de matériel" }}
      />

      <MaterialRequestEditor projectId={projectId} requestId={requestId} affaireName={project.name} />
    </>
  );
}
