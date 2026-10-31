import { notFound } from "next/navigation";

import { JourneyPageHeader } from "@/components/journey/JourneyPage";
import { ProjectPlanCenter } from "@/components/takeoff/ProjectPlanCenter";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { fetchPlanSetsForProject, hasTakeoffAnalysisForProject } from "@/lib/takeoff/plans";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AffairePlansPage({ params }: Props) {
  const [{ projectId }, { tenantId }] = await Promise.all([
    params,
    getUserContext(),
  ]);

  if (!tenantId) {
    notFound();
  }

  const takeoffEnabled = await isTakeoffEnabled(tenantId);
  if (!takeoffEnabled) {
    notFound();
  }

  const [projectResult, planSetsResult, analysisResult] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchPlanSetsForProject(projectId),
    hasTakeoffAnalysisForProject(projectId),
  ]);

  if (projectResult.status === "rejected") {
    const err = projectResult.reason as unknown;
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "NOT_FOUND"
    ) {
      notFound();
    }
    throw err;
  }

  const project = projectResult.value;
  const initialPlanSets =
    planSetsResult.status === "fulfilled" ? planSetsResult.value : undefined;

  return (
    <div className="journey-page">
      <JourneyPageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Plans" },
        ]}
        title="Plans"
        stage="Étude"
        context="Rangez les plans PDF de l’affaire en jeux. L’IA s’en sert pour préparer le métré."
      />

      <ProjectPlanCenter
        projectId={projectId}
        initialPlanSets={initialPlanSets}
        hasTakeoffAnalysis={analysisResult.status === "fulfilled" && analysisResult.value}
      />
    </div>
  );
}
