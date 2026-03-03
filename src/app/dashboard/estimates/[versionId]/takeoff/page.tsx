import Link from "next/link";
import { notFound } from "next/navigation";

import TakeoffJobList from "@/components/takeoff/TakeoffJobList";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

export default async function TakeoffJobsPage({
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

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Historique des extractions</h1>
          <p className="page-description">
            Historique des extractions, suivi des statuts et actions rapides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/estimates/${versionId}`}
            className="btn btn-secondary btn-sm"
          >
            Retour au chiffrage
          </Link>
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/new`}
            className="btn btn-primary btn-sm"
          >
            Nouvelle extraction
          </Link>
        </div>
      </div>

      <TakeoffJobList versionId={versionId} />
    </div>
  );
}
