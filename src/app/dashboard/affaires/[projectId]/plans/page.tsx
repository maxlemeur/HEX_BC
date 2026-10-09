import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectPlanCenter } from "@/components/takeoff/ProjectPlanCenter";
import { TakeoffRouteHierarchyBanner } from "@/components/takeoff/TakeoffRouteHierarchyBanner";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";
import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

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
    <div className="min-w-0">
      <PageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Plans" },
        ]}
        title="Plans"
        description="Organisez vos plans PDF en jeux pour le métré de cette affaire."
      />

      <TakeoffRouteHierarchyBanner
        descriptor={buildTakeoffRouteHierarchy({ kind: "affaire_plans" })}
      />

      <ProjectPlanCenter
        projectId={projectId}
        initialPlanSets={initialPlanSets}
      />
    </div>
  );
}
