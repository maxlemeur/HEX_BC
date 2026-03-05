import { notFound } from "next/navigation";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { LastAffaireTracker } from "@/components/affaires/LastAffaireTracker";
import ProjectTakeoffJobList from "@/components/takeoff/ProjectTakeoffJobList";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

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

  const [projectResult, versionsResult] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchProjectVersionList(projectId),
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

  return (
    <>
      <LastAffaireTracker projectId={projectId} />
      <HubBreadcrumb
        hubHref="/dashboard/affaires"
        hubLabel="Mes affaires"
        intermediateHref={`/dashboard/affaires/${projectId}`}
        intermediateLabel={project.name}
        currentLabel="Extractions"
      />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--slate-900)]">
          Extractions
        </h1>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Historique des extractions de metres pour cette affaire, toutes
          versions confondues.
        </p>
      </div>

      <ProjectTakeoffJobList projectId={projectId} versions={versions} />
    </>
  );
}
