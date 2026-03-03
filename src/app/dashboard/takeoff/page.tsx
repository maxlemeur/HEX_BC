import Link from "next/link";
import { notFound } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { listLatestEstimates } from "@/lib/estimates/server";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoye",
  accepted: "Accepte",
  archived: "Archive",
};
const DEFAULT_CURRENCY: SupportedEstimateCurrency = "EUR";

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

function resolveCurrency(currency: string | null | undefined): SupportedEstimateCurrency {
  return normalizeEstimateCurrency(currency) ?? DEFAULT_CURRENCY;
}

export default async function TakeoffPage() {
  const { tenantId } = await getUserContext();

  if (!tenantId) {
    notFound();
  }

  const enabled = await isTakeoffEnabled(tenantId);
  if (!enabled) {
    notFound();
  }
  const { items } = await listLatestEstimates();

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Extraction de plans</h1>
          <p className="page-description">
            Selectionnez un chiffrage pour acceder au suivi des extractions et lancer de nouveaux
            metrage
            plans.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/estimates" className="btn btn-secondary btn-sm">
            Retour aux chiffrages
          </Link>
          <Link href="/dashboard/estimates/new" className="btn btn-primary btn-sm">
            Nouveau chiffrage
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="dashboard-card mt-6 p-6">
          <p className="text-sm text-[var(--slate-700)]">
            Aucun chiffrage disponible pour lancer l&apos;extraction.
          </p>
        </div>
      ) : (
        <div className="dashboard-card mt-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-[var(--slate-200)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
                  <th className="px-4 py-3 font-semibold">Projet</th>
                  <th className="px-4 py-3 font-semibold">Version</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold">MAJ</th>
                  <th className="px-4 py-3 font-semibold">Total HT</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const statusLabel = STATUS_LABEL[item.status] ?? item.status;

                  return (
                    <tr
                      key={item.version_id}
                      className="border-b border-[var(--slate-100)] align-top"
                    >
                      <td className="px-4 py-4">
                        <p className="font-semibold text-[var(--slate-800)]">{item.project_name}</p>
                        <p className="text-xs text-[var(--slate-500)]">
                          {item.project_reference ?? "Sans reference"}
                          {item.project_client_name
                            ? ` - ${item.project_client_name}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">
                        V{item.version_number}
                      </td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">{statusLabel}</td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">
                        {formatUpdatedAt(item.updated_at)}
                      </td>
                      <td className="px-4 py-4 text-[var(--slate-700)]">
                        {formatCurrency(item.total_ht_cents, resolveCurrency(item.currency))}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={`/dashboard/estimates/${item.version_id}/takeoff`}
                          className="btn btn-secondary btn-sm"
                        >
                          Ouvrir l&apos;extraction
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
