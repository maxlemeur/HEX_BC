import Link from "next/link";

import { buildDashboardShortcuts } from "@/app/dashboard/dashboard-shortcuts";
import { DashboardHomeResumeLink } from "@/components/dashboard/DashboardHomeResumeLink";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchAffaireDashboardOverview,
  type AffaireListItem,
} from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";

const STATUS_LABELS: Record<
  "draft" | "sending" | "sent" | "accepted" | "archived",
  string
> = {
  draft: "Brouillon",
  sending: "Envoi en cours",
  sent: "Envoyée",
  accepted: "Acceptée",
  archived: "Archivée",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function StatusBadge({ item }: Readonly<{ item: AffaireListItem }>) {
  const status = item.currentStatus ?? "draft";
  const className =
    status === "accepted"
      ? "bg-emerald-50 text-emerald-700"
      : status === "sent"
        ? "bg-blue-50 text-blue-700"
        : status === "archived"
          ? "bg-slate-100 text-slate-600"
          : "bg-amber-50 text-amber-800";

  return (
    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${className}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function ShortcutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

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
  const metrics = [
    { label: "Affaires actives", value: activeCount, accent: true },
    { label: "Brouillons", value: statusCounts.draft },
    { label: "Envoyées", value: statusCounts.sent },
    { label: "Acceptées", value: statusCounts.accepted },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-fade-in sm:space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--brand-orange-dark)]">
            Centre de pilotage
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--slate-900)] sm:text-4xl">
            Vue d’ensemble
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--slate-600)] sm:text-base">
            Retrouvez les dossiers à reprendre et les accès utiles pour votre rôle.
          </p>
        </div>
        <Link
          href={canCreateAffaire ? "/dashboard/affaires/new" : "/dashboard/affaires"}
          className="btn btn-primary min-h-11 w-full sm:w-auto"
        >
          {canCreateAffaire ? "Nouvelle affaire" : "Voir les affaires"}
        </Link>
      </header>

      <section aria-labelledby="dashboard-overview-heading">
        <h2 id="dashboard-overview-heading" className="sr-only">
          Indicateurs des affaires
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="dashboard-card min-w-0 p-4 sm:p-5"
            >
              <dt className="text-xs font-semibold text-[var(--slate-500)] sm:text-sm">
                {metric.label}
              </dt>
              <dd
                className={`mt-2 text-3xl font-bold tabular-nums tracking-tight ${
                  metric.accent
                    ? "text-[var(--brand-orange-dark)]"
                    : "text-[var(--slate-900)]"
                }`}
              >
                {metric.value.toLocaleString("fr-FR")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
        <section
          aria-labelledby="recent-affaires-heading"
          className="dashboard-card min-w-0 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--slate-100)] px-4 py-4 sm:px-5">
            <div>
              <h2 id="recent-affaires-heading" className="font-semibold text-[var(--slate-900)]">
                Affaires récentes
              </h2>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                Les cinq derniers dossiers mis à jour
              </p>
            </div>
            <Link
              href="/dashboard/affaires"
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-[var(--brand-blue)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]"
            >
              Tout voir
            </Link>
          </div>

          {recentAffaires.length > 0 ? (
            <ul className="divide-y divide-[var(--slate-100)]">
              {recentAffaires.map((item) => (
                <li key={item.projectId}>
                  <Link
                    href={`/dashboard/affaires/${item.projectId}`}
                    prefetch={false}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand-blue)] sm:px-5"
                    aria-label={`Ouvrir l'affaire ${item.projectName}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                        {item.projectName}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--slate-500)]">
                        {item.projectClient || item.projectReference || "Client non renseigné"}
                        <span aria-hidden="true"> · </span>
                        <time dateTime={item.currentUpdatedAt}>
                          {DATE_FORMATTER.format(new Date(item.currentUpdatedAt))}
                        </time>
                      </p>
                    </div>
                    <StatusBadge item={item} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              className="m-4 border-0 py-10 shadow-none"
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                </svg>
              }
              title="Aucune affaire pour le moment"
              description="Créez votre première affaire pour démarrer un chiffrage."
              actionLabel={canCreateAffaire ? "Créer une affaire" : undefined}
              actionHref={canCreateAffaire ? "/dashboard/affaires/new" : undefined}
            />
          )}
        </section>

        <div className="space-y-6">
          <section
            aria-labelledby="quick-access-heading"
            className="dashboard-card p-4 sm:p-5"
          >
            <h2 id="quick-access-heading" className="font-semibold text-[var(--slate-900)]">
              Accès rapides
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {shortcuts.map((shortcut) => (
                <Link
                  key={shortcut.href}
                  href={shortcut.href}
                  prefetch={false}
                  className="group flex min-h-14 items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-[var(--slate-200)] hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {shortcut.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--slate-500)]">
                      {shortcut.description}
                    </p>
                  </div>
                  <span className="text-[var(--slate-400)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-blue)]">
                    <ShortcutIcon />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="resume-affaire-heading"
            className="dashboard-card p-4 sm:p-5"
          >
            <h2 id="resume-affaire-heading" className="font-semibold text-[var(--slate-900)]">
              Continuer votre travail
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--slate-500)]">
              Revenez au dernier dossier consulté sur cet appareil.
            </p>
            <div className="mt-4">
              <DashboardHomeResumeLink />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
