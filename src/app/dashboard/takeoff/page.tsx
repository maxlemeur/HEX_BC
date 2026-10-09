import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { TakeoffDeprecationBanner } from "@/components/takeoff/TakeoffDeprecationBanner";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchAffaireList } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";
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
      <PageHeader
        title="Métrés — Analyse de plans"
        description="Sélectionnez une affaire pour accéder au suivi des analyses et lancer de nouveaux métrés."
        actions={
          <>
            <Link
              href="/dashboard/affaires"
              prefetch={false}
              className={buttonVariants({ variant: "outline" })}
            >
              Retour aux affaires
            </Link>
            <Link
              href="/dashboard/affaires/new"
              prefetch={false}
              className={buttonVariants({ variant: "primary" })}
            >
              Nouvelle affaire
            </Link>
          </>
        }
      />

      <TakeoffDeprecationBanner
        descriptor={buildTakeoffRouteHierarchy({ kind: "dashboard_takeoff_legacy" })}
      />

      {items.length === 0 ? (
        <EmptyState
          className="mt-6"
          headingLevel={2}
          title="Aucune affaire disponible"
          description="Créez une affaire pour lancer une analyse de plans."
        />
      ) : (
        <Card className="mt-6 overflow-hidden">
          <div
            className="relative overflow-x-auto"
            role="region"
            aria-label="Affaires disponibles pour le métré"
            tabIndex={0}
          >
            <table className="w-full min-w-[600px] text-sm">
              <caption className="sr-only">Affaires disponibles pour le métré</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-semibold">Projet</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Version</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Mise à jour</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Action</span>
                  </th>
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
                      className="border-b border-border-subtle align-top"
                    >
                      <td className="px-4 py-4">
                        <p className="font-semibold text-foreground">{item.projectName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.projectReference ?? "Sans référence"}
                          {item.projectClient
                            ? ` · ${item.projectClient}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-foreground-secondary">
                        {item.currentVersionNumber === null
                          ? "—"
                          : `V${item.currentVersionNumber}`}
                      </td>
                      <td className="px-4 py-4 text-foreground-secondary">{statusLabel}</td>
                      <td className="px-4 py-4 text-foreground-secondary">
                        {formatUpdatedAt(item.currentUpdatedAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={targetHref}
                          prefetch={false}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                          aria-label={`${item.currentVersionId ? "Ouvrir les métrés" : "Ouvrir l’affaire"} ${item.projectName}`}
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
            <div className="flex justify-end border-t border-border-subtle px-4 py-3">
              <Link
                href={`/dashboard/takeoff?cursor=${encodeURIComponent(result.nextCursor)}`}
                prefetch={false}
                className={buttonVariants({ variant: "outline" })}
              >
                Affaires suivantes
              </Link>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
