import { notFound } from "next/navigation";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import TakeoffActivityCenter from "@/components/takeoff/TakeoffActivityCenter";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AffaireTakeoffPage({ params }: Props) {
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

  const [projectResult, versionsResult, planSetsResult] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchProjectVersionList(projectId),
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
  const versions =
    versionsResult.status === "fulfilled" ? versionsResult.value : [];
  const planSets =
    planSetsResult.status === "fulfilled" ? planSetsResult.value : [];

  return (
    <>
      <HubBreadcrumb
        hubHref="/dashboard/affaires"
        hubLabel="Mes affaires"
        intermediateHref={`/dashboard/affaires/${projectId}`}
        intermediateLabel={project.name}
        currentLabel="Metres"
      />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--slate-900)]">
          Centre d&apos;activite &mdash; Metres
        </h1>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Suivez les analyses de plans, les exceptions et l&apos;historique
          d&apos;application.
        </p>
      </div>

      <TakeoffActivityCenter
        projectId={projectId}
        versions={versions}
        planSets={planSets.map((ps) => ({
          id: ps.id,
          name: ps.name,
          metadata: ps.metadata,
        }))}
      />
    </>
  );
}
