import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

export default async function TakeoffPage() {
  const { tenantId } = await getUserContext();

  if (!tenantId) {
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
          <h1 className="page-title">Takeoff</h1>
          <p className="page-description">
            Module active pour ce tenant. Les flux metrage seront ajoutes dans les prochains
            tickets.
          </p>
        </div>
        <Link href="/dashboard/estimates" className="btn btn-secondary btn-sm">
          Retour aux chiffrages
        </Link>
      </div>

      <div className="dashboard-card mt-6 p-6">
        <p className="text-sm text-[var(--slate-700)]">
          Le flag <code>TAKEOFF_MODULE_ENABLED</code> est actif.
        </p>
      </div>
    </div>
  );
}
