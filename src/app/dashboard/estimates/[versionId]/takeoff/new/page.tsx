import Link from "next/link";
import { notFound } from "next/navigation";

import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

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

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Lancer un takeoff</h1>
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

      <TakeoffUploadForm versionId={versionId} />
    </div>
  );
}
