import { notFound } from "next/navigation";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { ProjectPlanCenter } from "@/components/takeoff/ProjectPlanCenter";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";

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

  const [projectResult, planSetsResult] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchPlanSetsForProject(projectId),
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
    <>
      <HubBreadcrumb
        hubHref={`/dashboard/affaires/${projectId}`}
        hubLabel={project.name}
        currentLabel="Plans"
      />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--slate-900)]">Plans</h1>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Organisez vos plans PDF en jeux pour le metre de cette affaire.
        </p>
      </div>

      <ProjectPlanCenter
        projectId={projectId}
        initialPlanSets={initialPlanSets}
      />
    </>
  );
}
