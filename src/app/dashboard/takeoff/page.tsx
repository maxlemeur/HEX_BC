import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchAffaireList } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";
import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
};
const TAKEOFF_PAGE_SIZE = 20;

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Date inconnue";
  }

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function TakeoffPage({ searchParams }: Props) {
  const [{ tenantId }, search] = await Promise.all([getUserContext(), searchParams]);

  if (!tenantId) {
    notFound();
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    notFound();
  }

  const cursor = typeof search.cursor === "string" ? search.cursor : null;
  const result = await fetchAffaireList({
    size: TAKEOFF_PAGE_SIZE,
    cursor,
    sort: "updatedAt",
    dir: "desc",
  });
  const items = result.items;

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Métrés — Analyse de plans</h1>
          <p className="page-description">
            Sélectionnez une affaire pour accéder au suivi des analyses et lancer de nouveaux
            métrés.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/affaires"
            prefetch={false}
            className="btn btn-secondary btn-sm"
          >
            Retour aux affaires
          </Link>
          <Link
            href="/dashboard/affaires/new"
            prefetch={false}
            className="btn btn-primary btn-sm"
          >
            Nouvelle affaire
          </Link>
        </div>
      </div>

      <TakeoffDeprecationBanner
        descriptor={buildTakeoffRouteHierarchy({ kind: "dashboard_takeoff_legacy" })}
      />

      {items.length === 0 ? (
        <div className="dashboard-card mt-6 p-6">
          <p className="text-sm text-[var(--slate-700)]">
            Aucune affaire disponible pour lancer une analyse de plans.
          </p>
        </div>
      ) : (
        <div className="dashboard-card mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-[var(--slate-200)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Projet</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Version</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 font-semibold">MAJ</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const statusLabel = item.currentStatus
                    ? (STATUS_LABEL[item.currentStatus] ?? item.currentStatus)
                    : "Sans version";
                  const targetHref = item.currentVersionId
                    ? `/dashboard/estimates/${item.currentVersionId}/takeoff`
                    : `/dashboard/affaires/${item.projectId}`;

                  return (
                    <tr
                      key={item.projectId}
                      className="border-b border-[var(--slate-100)] align-top"
                    >
                      <td className="px-4 py-4">
                        <p className="font-semibold text-[var(--slate-800)]">{item.projectName}</p>
                        <p className="text-xs text-[var(--slate-500)]">
                          {item.projectReference ?? "Sans référence"}
                          {item.projectClient
                            ? ` - ${item.projectClient}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">
                        {item.currentVersionNumber === null
                          ? "—"
                          : `V${item.currentVersionNumber}`}
                      </td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">{statusLabel}</td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">
                        {formatUpdatedAt(item.currentUpdatedAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={targetHref}
                          prefetch={false}
                          className="btn btn-secondary btn-sm"
                        >
                          {item.currentVersionId ? "Ouvrir les métrés" : "Ouvrir l’affaire"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.hasNextPage && result.nextCursor ? (
            <div className="flex justify-end border-t border-[var(--slate-100)] px-4 py-3">
              <Link
                href={`/dashboard/takeoff?cursor=${encodeURIComponent(result.nextCursor)}`}
                prefetch={false}
                className="btn btn-secondary btn-sm"
              >
                Affaires suivantes
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
