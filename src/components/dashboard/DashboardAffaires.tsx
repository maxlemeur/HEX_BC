"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { DASHBOARD_VIEWS, dashboardHref, type DashboardQuery } from "@/lib/affaires/dashboard";
import type { AffaireDashboardWorkspaceResult, AffaireListItem } from "@/lib/affaires/server";
import { cn } from "@/lib/utils";

const STATUS_BADGES: Record<NonNullable<AffaireListItem["currentStatus"]>, {
  label: string; variant: NonNullable<BadgeProps["variant"]>;
}> = {
  draft: { label: "Brouillon", variant: "warning" },
  sending: { label: "Envoi en cours", variant: "info" },
  sent: { label: "Envoyée", variant: "info" },
  accepted: { label: "Acceptée", variant: "success" },
  archived: { label: "Archivée", variant: "neutral" },
};
const DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
const NAV_LINK = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function DashboardAffaires({ data, query }: Readonly<{
  data: AffaireDashboardWorkspaceResult;
  query: DashboardQuery;
}>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const counts = { all: data.counters.totalCount, ...data.counters.statusCounts };
  const recent = query.view === "recent";
  const title = recent ? "Affaires récentes" : "Affaires";

  return (
    <section aria-labelledby="dashboard-affaires-heading" className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 px-4 pt-3 sm:px-5">
        <h2 id="dashboard-affaires-heading" className="text-lg font-semibold text-foreground">{title}</h2>
        <span role="status" aria-live="polite" aria-atomic="true" className="flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground">
          {isPending ? <><LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /> Chargement…</> :
            `${data.affaires.length} affaire${data.affaires.length > 1 ? "s" : ""}${recent ? " récentes" : " affichées"}`}
        </span>
      </div>
      <nav aria-label="Filtrer les affaires" className="flex flex-wrap gap-x-1 border-b border-border px-2 sm:px-3">
        {DASHBOARD_VIEWS.map(view => (
          <Link key={view.value} href={dashboardHref(view.value)} prefetch={false} scroll={false}
            aria-current={query.view === view.value ? "page" : undefined}
            onNavigate={event => { event.preventDefault(); navigate(dashboardHref(view.value)); }}
            className={cn("inline-flex min-h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ring",
              query.view === view.value ? "border-brand-orange text-primary" : "border-transparent text-muted-foreground hover:bg-surface-subtle hover:text-foreground")}
          >
            {view.label}
            {view.value !== "recent" ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-foreground-secondary">{counts[view.value].toLocaleString("fr-FR")}</span> : null}
          </Link>
        ))}
      </nav>
      <div aria-busy={isPending} className={cn("transition-opacity motion-reduce:transition-none", isPending && "opacity-60")}>
        <table className="w-full table-fixed text-left text-sm" aria-label={title}>
          <thead className="border-b border-border-subtle bg-surface-subtle text-xs font-medium text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 sm:w-[38%] sm:px-5">Affaire</th>
              <th scope="col" className="hidden w-[25%] px-3 py-3 md:table-cell">Client</th>
              <th scope="col" className="w-28 px-2 py-3 sm:w-[20%]">Statut</th>
              <th scope="col" className="hidden w-[17%] py-3 pr-4 md:table-cell sm:pr-5">Modifié</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {data.affaires.map(item => {
              const status = STATUS_BADGES[item.currentStatus ?? "draft"];
              const date = DATE_FORMATTER.format(new Date(item.currentUpdatedAt));
              return (
                <tr key={item.projectId} className="group hover:bg-surface-subtle focus-within:bg-surface-subtle">
                  <td className="px-4 py-3 sm:px-5">
                    <Link href={`/dashboard/affaires/${item.projectId}`} prefetch={false} className="block rounded-sm font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                      <span className="block truncate" title={item.projectName}>{item.projectName}</span>
                    </Link>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      <span className="hidden md:inline">{item.projectReference || "Sans référence"}</span>
                      <span className="md:hidden">{item.projectClient || "Client non renseigné"} · {date}</span>
                    </span>
                  </td>
                  <td className="hidden truncate px-3 py-3 text-foreground-secondary md:table-cell" title={item.projectClient || undefined}>{item.projectClient || "Non renseigné"}</td>
                  <td className="px-2 py-3"><Badge variant={status.variant} dot size="sm">{status.label}</Badge></td>
                  <td className="hidden py-3 pr-4 text-xs text-muted-foreground md:table-cell sm:pr-5"><time dateTime={item.currentUpdatedAt}>{date}</time></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.affaires.length === 0 ? <EmptyState variant="compact" title={recent || query.view === "all" ? "Aucune affaire pour le moment" : "Aucune affaire dans ce statut"} description={recent || query.view === "all" ? "Vos dossiers apparaîtront ici dès leur création." : "Choisissez un autre filtre pour retrouver vos dossiers."} /> : null}
      </div>
      {!recent ? <nav aria-label="Pagination des affaires" className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-2 py-2 sm:px-3">
        {data.previousCursor ? <Link href={dashboardHref(query.view, { cursor: data.previousCursor, direction: "previous" })} prefetch={false} scroll={false} onNavigate={event => { event.preventDefault(); navigate(dashboardHref(query.view, { cursor: data.previousCursor!, direction: "previous" })); }} className={NAV_LINK}><ArrowLeftIcon aria-hidden="true" className="size-4" /> Précédente</Link> : <span aria-disabled="true" className="px-3 text-xs text-muted-foreground">Première page</span>}
        <span className="text-xs text-muted-foreground">20 par page</span>
        {data.nextCursor ? <Link href={dashboardHref(query.view, { cursor: data.nextCursor, direction: "next" })} prefetch={false} scroll={false} onNavigate={event => { event.preventDefault(); navigate(dashboardHref(query.view, { cursor: data.nextCursor!, direction: "next" })); }} className={NAV_LINK}>Suivante <ArrowRightIcon aria-hidden="true" className="size-4" /></Link> : <span aria-disabled="true" className="px-3 text-xs text-muted-foreground">Fin de liste</span>}
      </nav> : null}
    </section>
  );
}
