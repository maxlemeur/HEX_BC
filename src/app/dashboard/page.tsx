import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, FolderIcon, PlusIcon } from "lucide-react";

import { buildDashboardShortcuts } from "@/app/dashboard/dashboard-shortcuts";
import { DashboardHomeResumeLink } from "@/components/dashboard/DashboardHomeResumeLink";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  fetchAffaireDashboardOverview,
  type AffaireListItem,
} from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Accueil" };

type AffaireStatus = NonNullable<AffaireListItem["currentStatus"]>;

const STATUS_BADGES: Record<AffaireStatus, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  draft: { label: "Brouillon", variant: "warning" },
  sending: { label: "Envoi en cours", variant: "info" },
  sent: { label: "Envoyée", variant: "info" },
  accepted: { label: "Acceptée", variant: "success" },
  archived: { label: "Archivée", variant: "neutral" },
};

const DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function DashboardPage() {
  const [{ profile }, overview] = await Promise.all([
    getUserContext(),
    fetchAffaireDashboardOverview(),
  ]);
  const role = profile?.tenant_role ?? null;
  const canCreateAffaire = role === "admin" || role === "engineer";
  const statusCounts = overview.counters.statusCounts;
  const activeCount = Math.max(
    0,
    overview.counters.totalCount - statusCounts.archived
  );
  const recentAffaires = overview.recentAffaires;
  const shortcuts = buildDashboardShortcuts(role, profile?.ui_mode ?? "simplified");

  return (
    <div className="mx-auto max-w-7xl animate-fade-in">
      <PageHeader
        eyebrow="Centre de pilotage"
        title="Vue d’ensemble"
        description="Retrouvez les dossiers à reprendre et les accès utiles pour votre rôle."
        actions={
          <Link
            href={canCreateAffaire ? "/dashboard/affaires/new" : "/dashboard/affaires"}
            className={buttonVariants({ variant: "primary", size: "lg", className: "w-full sm:w-auto" })}
          >
            {canCreateAffaire ? (
              <>
                <PlusIcon aria-hidden="true" />
                Nouvelle affaire
              </>
            ) : (
              "Voir les affaires"
            )}
          </Link>
        }
      />

      <div className="flex flex-col gap-6 sm:gap-8">
        <section aria-labelledby="dashboard-overview-heading">
          <h2 id="dashboard-overview-heading" className="sr-only">
            Indicateurs des affaires
          </h2>
          <StatGrid>
            <StatCard label="Affaires actives" value={activeCount.toLocaleString("fr-FR")} tone="brand" />
            <StatCard label="Brouillons" value={statusCounts.draft.toLocaleString("fr-FR")} />
            <StatCard label="Envoyées" value={statusCounts.sent.toLocaleString("fr-FR")} />
            <StatCard label="Acceptées" value={statusCounts.accepted.toLocaleString("fr-FR")} />
          </StatGrid>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
          <PageSection
            title="Affaires récentes"
            description="Les cinq derniers dossiers mis à jour"
            flush
            actions={
              <Link
                href="/dashboard/affaires"
                className={buttonVariants({ variant: "link", className: "min-h-11 sm:min-h-0" })}
              >
                Tout voir
              </Link>
            }
          >
            {recentAffaires.length > 0 ? (
              <ul className="divide-y divide-border-subtle">
                {recentAffaires.map((item) => {
                  const status = STATUS_BADGES[item.currentStatus ?? "draft"];
                  return (
                    <li key={item.projectId}>
                      <Link
                        href={`/dashboard/affaires/${item.projectId}`}
                        prefetch={false}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {item.projectName}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {item.projectClient || item.projectReference || "Client non renseigné"}
                            <span aria-hidden="true"> · </span>
                            <time dateTime={item.currentUpdatedAt}>
                              {DATE_FORMATTER.format(new Date(item.currentUpdatedAt))}
                            </time>
                          </p>
                        </div>
                        <Badge variant={status.variant} dot>
                          {status.label}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                variant="plain"
                icon={<FolderIcon />}
                title="Aucune affaire pour le moment"
                description="Créez votre première affaire pour démarrer un chiffrage."
                action={
                  canCreateAffaire ? (
                    <Link href="/dashboard/affaires/new" className={buttonVariants({ variant: "primary", size: "md" })}>
                      Créer une affaire
                    </Link>
                  ) : undefined
                }
              />
            )}
          </PageSection>

          <div className="flex flex-col gap-6">
            <PageSection title="Accès rapides">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {shortcuts.map((shortcut) => (
                  <Link
                    key={shortcut.href}
                    href={shortcut.href}
                    prefetch={false}
                    className="group flex min-h-14 items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{shortcut.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{shortcut.description}</p>
                    </div>
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
                    />
                  </Link>
                ))}
              </div>
            </PageSection>

            <PageSection
              title="Continuer votre travail"
              description="Revenez au dernier dossier consulté sur cet appareil."
            >
              <DashboardHomeResumeLink />
            </PageSection>
          </div>
        </div>
      </div>
    </div>
  );
}
