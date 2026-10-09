import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PlanCenter } from "@/components/takeoff/PlanCenter";
import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  buildTakeoffRouteHierarchy,
  fetchTakeoffVersionProjectContext,
} from "@/lib/takeoff/route-hierarchy";
import { buttonVariants } from "@/components/ui/button";

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
      <PageHeader
        title="Plans"
        description="Organisez vos plans PDF en jeux avant de lancer une extraction."
        actions={
          <Link
            href={`/dashboard/estimates/${versionId}`}
            className={buttonVariants({ variant: "outline" })}
          >
            Retour au chiffrage
          </Link>
        }
      />

      <TakeoffDeprecationBanner descriptor={routeDescriptor} />

      <PlanCenter versionId={versionId} />
    </div>
  );
}
