import Link from "next/link";
import { notFound } from "next/navigation";

import { PlanCenter } from "@/components/takeoff/PlanCenter";
import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  buildTakeoffRouteHierarchy,
  fetchTakeoffVersionProjectContext,
} from "@/lib/takeoff/route-hierarchy";

export default async function PlanCenterPage({
  params,
}: Readonly<{
  params: Promise<{ versionId: string }>;
}>) {
  const { versionId } = await params;
  const { tenantId } = await getUserContext();

  if (!tenantId || versionId.trim().length === 0) {
    notFound();
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    notFound();
  }

  const routeDescriptor = buildTakeoffRouteHierarchy({
    kind: "estimate_plans_legacy",
    ...(await fetchTakeoffVersionProjectContext(versionId)),
  });

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Plan Center</h1>
          <p className="page-description">
            Organisez vos plans PDF en jeux avant de lancer une extraction.
          </p>
        </div>
        <Link
          href={`/dashboard/estimates/${versionId}`}
          className="btn btn-secondary btn-sm"
        >
          Retour au chiffrage
        </Link>
      </div>

      <TakeoffDeprecationBanner descriptor={routeDescriptor} />

      <PlanCenter versionId={versionId} />
    </div>
  );
}
