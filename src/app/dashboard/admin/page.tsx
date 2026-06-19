import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

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
      <section className="space-y-3 animate-slide-in stagger-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Système
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/tenants"
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
                <rect width="18" height="14" x="3" y="4" rx="2" />
                <path d="M8 20h8" />
                <path d="M12 16v4" />
                <path d="M8 10h8" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">Tenant</h3>
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
      <section className="space-y-3 animate-slide-in stagger-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Configuration
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/dashboard/admin/suggestion-learning"
            className="dashboard-card hub-card p-5"
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
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l3 3" />
                <path d="M8 12h.01" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Suggestion learning
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Apprentissage des suggestions automatiques
            </p>
          </Link>

          <Link
            href="/dashboard/admin/anomaly-history"
            className="dashboard-card hub-card p-5"
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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Historique anomalies
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
                <path d="M4 6h16" />
                <path d="M4 12h10" />
                <path d="M4 18h7" />
                <circle cx="17" cy="12" r="2" />
                <circle cx="14" cy="18" r="2" />
                <circle cx="9" cy="6" r="2" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">Rules engine</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Règles métier et moteur de validation
            </p>
          </Link>

          <Link
            href="/dashboard/admin/flags"
            className="dashboard-card hub-card p-5"
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
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" x2="4" y1="22" y2="15" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Feature flags
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Activation et configuration des fonctionnalités
            </p>
          </Link>

          <Link
            href="/dashboard/admin/procurement-reset"
            className="dashboard-card hub-card p-5 border-red-200"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#b91c1c"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </div>
            <h3 className="mt-3 font-semibold text-foreground">
              Nettoyage achats
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Suppression controlee des fournisseurs et bons de commande
            </p>
          </Link>
        </div>
      </section>

      {/* Section: Modules (conditional) */}
      {takeoffEnabled ? (
        <section className="space-y-3 animate-slide-in stagger-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                Règles d&apos;extraction
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Règles de correspondance du module d&apos;extraction
              </p>
            </Link>

            <Link
              href="/dashboard/admin/takeoff/metrics"
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
                  <path d="M3 3v18h18" />
                  <path d="m7 12 4-4 4 4 4-4" />
                </svg>
              </div>
              <h3 className="mt-3 font-semibold text-foreground">
                Métriques d&apos;extraction
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Observabilite des extractions, couts et performances
              </p>
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
