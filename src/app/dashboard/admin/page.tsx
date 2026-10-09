import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { ChartLineIcon, ClockIcon, FlagIcon, MonitorIcon, ShieldAlertIcon, SlidersHorizontalIcon, Trash2Icon } from "lucide-react";

export default async function AdminHubPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const takeoffEnabled = await isTakeoffEnabled(tenantId);

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="animate-slide-in stagger-1">
        <h1 className="text-2xl font-bold text-foreground">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuration et paramétrage de la plateforme
        </p>
      </div>

      {/* Section: Système */}
      <section
        aria-labelledby="admin-system-heading"
        className="space-y-3 animate-slide-in stagger-2"
      >
        <h2
          id="admin-system-heading"
          className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground"
        >
          Système
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/tenants"
            className="dashboard-card hub-card p-5 sm:col-span-1 lg:col-span-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <MonitorIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
            </div>
            <h3 className="mt-3 font-semibold text-foreground">Organisation</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Paramètres généraux de l&apos;organisation
            </p>
          </Link>

          <Link
            href="/dashboard/admin/currencies"
            className="dashboard-card hub-card p-5 sm:col-span-1 lg:col-span-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand-blue)"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 5h12" />
                <path d="M9 3v4" />
                <path d="m16 9 4 4-4 4" />
                <path d="M20 13H8" />
                <path d="M4 19h9" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">Devises</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Gestion des devises et taux de change
            </p>
          </Link>
        </div>
      </section>

      {/* Section: Configuration */}
      <section
        aria-labelledby="admin-configuration-heading"
        className="space-y-3 animate-slide-in stagger-3"
      >
        <h2
          id="admin-configuration-heading"
          className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground"
        >
          Configuration
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/admin/suggestion-learning"
            className="dashboard-card hub-card p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <ClockIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Apprentissage des suggestions
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Réglages de l&apos;apprentissage automatique
            </p>
          </Link>

          <Link
            href="/dashboard/admin/anomaly-history"
            className="dashboard-card hub-card p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <ShieldAlertIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Historique des anomalies
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Suivi et résolution des anomalies détectées
            </p>
          </Link>

          <Link
            href="/dashboard/admin/rules"
            className="dashboard-card hub-card p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <SlidersHorizontalIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Règles de contrôle
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Règles métier et moteur de validation
            </p>
          </Link>

          <Link
            href="/dashboard/admin/flags"
            className="dashboard-card hub-card p-5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <FlagIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Fonctionnalités
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Activation et configuration des modules
            </p>
          </Link>
        </div>
      </section>

      {/* Section: Modules (conditional) */}
      {takeoffEnabled ? (
        <section
          aria-labelledby="admin-modules-heading"
          className="space-y-3 animate-slide-in stagger-4"
        >
          <h2
            id="admin-modules-heading"
            className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground"
          >
            Modules
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/dashboard/admin/takeoff/mapping-rules"
              className="dashboard-card hub-card p-5 sm:col-span-1 lg:col-span-2"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--brand-blue)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3 8 4-4 4 4" />
                  <path d="m13 16 4 4 4-4" />
                  <path d="M7 4v8h10" />
                  <path d="M17 20v-8H7" />
                </svg>
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Règles de métrés
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Correspondances utilisées pendant l&apos;analyse des plans
              </p>
            </Link>

            <Link
              href="/dashboard/admin/takeoff/metrics"
              className="dashboard-card hub-card p-5 sm:col-span-1 lg:col-span-2"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
                <ChartLineIcon aria-hidden="true" stroke="var(--brand-blue)" strokeWidth="1.75" size={20} />
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Suivi des métrés
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Analyse des volumes, des coûts et des performances
              </p>
            </Link>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="admin-danger-heading"
        className="space-y-3 animate-slide-in stagger-5"
      >
        <h2
          id="admin-danger-heading"
          className="text-xs font-semibold uppercase tracking-wider text-red-700"
        >
          Zone sensible
        </h2>
        <Link
          href="/dashboard/admin/procurement-reset"
          className="dashboard-card flex flex-col gap-3 border-red-200 bg-red-50/60 p-5 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
            <Trash2Icon aria-hidden="true" stroke="#b91c1c" strokeWidth="1.75" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-red-950">Nettoyage des achats</h3>
            <p className="mt-1 text-sm text-red-800">
              Suppression contrôlée des fournisseurs et des bons de commande
            </p>
          </div>
          <span className="text-sm font-semibold text-red-800">Ouvrir</span>
        </Link>
      </section>
    </div>
  );
}
