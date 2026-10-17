import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE } from "@/lib/estimates/engine/capabilities";

type EstimateEngineUnavailableNoticeProps = {
  versionNumber: number;
  projectId: string;
  projectName?: string | null;
};

/**
 * Lot 2, sous-lot 2.1 : page de lecture d'une version au moteur de calcul 3. Elle remplace la
 * fiche, l'impression et l'éditeur, qui ne savent calculer qu'en moteur 1 ou 2 : aucun montant
 * n'est recalculé et rien n'est écrit.
 */
export function EstimateEngineUnavailableNotice({
  versionNumber,
  projectId,
  projectName,
}: Readonly<EstimateEngineUnavailableNoticeProps>) {
  return (
    <div className="animate-fade-in space-y-4" data-testid="estimate-engine-unavailable">
      <PageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          ...(projectName ? [{ label: projectName, href: `/dashboard/affaires/${projectId}` }] : []),
          { label: `V${versionNumber}` },
        ]}
        title={`Chiffrage V${versionNumber}`}
        description={projectName ?? undefined}
        back={{ href: `/dashboard/affaires/${projectId}`, label: "Retour à l'affaire" }}
      />
      <Alert variant="warning">
        <AlertTitle>{ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE}</AlertTitle>
      </Alert>
    </div>
  );
}
