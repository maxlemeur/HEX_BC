import Link from "next/link";
import { notFound } from "next/navigation";

import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { ProductionRibbon, ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
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
      <ProductionRibbon ariaLabel="Ruban métier des métrés">
        <ProductionRibbonHeader
          breadcrumbs={[
            { label: "Chiffrages", href: "/dashboard/estimates" },
            { label: "Chiffrage", href: `/dashboard/estimates/${versionId}` },
            { label: "Métrés" },
          ]}
          title="Lancer une extraction"
          description="Chargez un fichier puis démarrez l'extraction"
          actions={
            <Link
              href={`/dashboard/estimates/${versionId}`}
              className="btn btn-secondary btn-sm"
            >
              Retour au chiffrage
            </Link>
          }
        />
        <nav className="production-ribbon__tabs" aria-label="Navigation des métrés">
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff`}
            className="production-ribbon__tab"
          >
            Extractions
          </Link>
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/new`}
            className="production-ribbon__tab"
            data-active="true"
            aria-current="page"
          >
            Nouvelle extraction
          </Link>
        </nav>
      </ProductionRibbon>

      <TakeoffDeprecationBanner descriptor={routeDescriptor} />

      <TakeoffUploadForm versionId={versionId} />
    </div>
  );
}
