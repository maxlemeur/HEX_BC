import Link from "next/link";
import { notFound } from "next/navigation";

import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  buildTakeoffRouteHierarchy,
  fetchTakeoffVersionProjectContext,
} from "@/lib/takeoff/route-hierarchy";

export default async function TakeoffNewPage({
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
    kind: "estimate_launch_legacy",
    versionId,
    ...(await fetchTakeoffVersionProjectContext(versionId)),
  });

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Lancer une extraction</h1>
          <p className="page-description">
            Chargez votre fichier puis demarrez l&apos;extraction.
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

      <TakeoffUploadForm versionId={versionId} />
    </div>
  );
}
