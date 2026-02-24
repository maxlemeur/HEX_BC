import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

export default async function TakeoffJobPage({
  params,
}: Readonly<{
  params: Promise<{ versionId: string; jobId: string }>;
}>) {
  const { versionId, jobId } = await params;
  const { tenantId } = await getUserContext();

  if (!tenantId || versionId.trim().length === 0 || jobId.trim().length === 0) {
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
          <h1 className="page-title">Job Takeoff</h1>
          <p className="page-description">
            Job cree avec succes. Le monitor detaille sera enrichi avec TKF-011.
          </p>
        </div>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/new`}
          className="btn btn-secondary btn-sm"
        >
          Nouveau job
        </Link>
      </div>

      <section className="dashboard-card p-6">
        <p className="text-sm text-[var(--slate-700)]">
          Identifiant du job: <span className="font-mono text-xs">{jobId}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/dashboard/estimates/${versionId}`} className="btn btn-secondary btn-sm">
            Retour au chiffrage
          </Link>
          <Link href="/dashboard/takeoff" className="btn btn-primary btn-sm">
            Ouvrir le module Takeoff
          </Link>
        </div>
      </section>
    </div>
  );
}
