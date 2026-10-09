import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownUpIcon,
  ArrowRightIcon,
  ChartLineIcon,
  CoinsIcon,
  FlagIcon,
  MonitorIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { cn } from "@/lib/utils";

type HubCardProps = {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
};

function HubCard({ href, icon, title, description, className }: HubCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-w-0 flex-col rounded-lg border border-border bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-primary/20 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-control bg-secondary text-primary [&_svg]:size-5"
      >
        {icon}
      </div>
      <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}

function HubSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("space-y-3", className)}>
      <h2 id={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default async function AdminHubPage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  const takeoffEnabled = await isTakeoffEnabled(tenantId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        className="animate-slide-in stagger-1"
        title="Administration"
        description="Configuration et paramétrage de la plateforme."
      />

      <div className="space-y-10">
        <HubSection id="admin-system-heading" title="Système" className="animate-slide-in stagger-2">
          <HubCard
            href="/dashboard/tenants"
            className="lg:col-span-2"
            icon={<MonitorIcon strokeWidth={1.75} />}
            title="Organisation"
            description="Paramètres généraux de l'organisation"
          />
          <HubCard
            href="/dashboard/admin/currencies"
            className="lg:col-span-2"
            icon={<CoinsIcon strokeWidth={1.75} />}
            title="Devises"
            description="Gestion des devises et des taux de change"
          />
        </HubSection>

        <HubSection
          id="admin-configuration-heading"
          title="Configuration"
          className="animate-slide-in stagger-3"
        >
          <HubCard
            href="/dashboard/admin/suggestion-learning"
            icon={<SparklesIcon strokeWidth={1.75} />}
            title="Apprentissage des suggestions"
            description="Réglages de l'apprentissage automatique"
          />
          <HubCard
            href="/dashboard/admin/anomaly-history"
            icon={<ShieldAlertIcon strokeWidth={1.75} />}
            title="Historique des anomalies"
            description="Suivi et résolution des anomalies détectées"
          />
          <HubCard
            href="/dashboard/admin/rules"
            icon={<SlidersHorizontalIcon strokeWidth={1.75} />}
            title="Règles de contrôle"
            description="Garde-fous de marge, de remise et seuils d'approbation"
          />
          <HubCard
            href="/dashboard/admin/flags"
            icon={<FlagIcon strokeWidth={1.75} />}
            title="Fonctionnalités"
            description="Activation et configuration des modules"
          />
        </HubSection>

        {takeoffEnabled ? (
          <HubSection id="admin-modules-heading" title="Modules" className="animate-slide-in stagger-4">
            <HubCard
              href="/dashboard/admin/takeoff/mapping-rules"
              className="lg:col-span-2"
              icon={<ArrowDownUpIcon strokeWidth={1.75} />}
              title="Règles de métrés"
              description="Correspondances utilisées pendant l'analyse des plans"
            />
            <HubCard
              href="/dashboard/admin/takeoff/metrics"
              className="lg:col-span-2"
              icon={<ChartLineIcon strokeWidth={1.75} />}
              title="Suivi des métrés"
              description="Analyse des volumes, des coûts et des performances"
            />
          </HubSection>
        ) : null}

        <section aria-labelledby="admin-danger-heading" className="space-y-3 animate-slide-in stagger-5">
          <h2
            id="admin-danger-heading"
            className="text-xs font-semibold uppercase tracking-wider text-danger"
          >
            Zone sensible
          </h2>
          <Link
            href="/dashboard/admin/procurement-reset"
            className="group flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-subtle p-5 transition-shadow hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger sm:flex-row sm:items-center sm:gap-4"
          >
            <div
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-control bg-danger-light text-danger"
            >
              <Trash2Icon strokeWidth={1.75} className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground">Nettoyage des achats</h3>
              <p className="mt-1 text-sm text-foreground-secondary">
                Suppression contrôlée des fournisseurs et des bons de commande
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-danger">
              Ouvrir
              <ArrowRightIcon
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </span>
          </Link>
        </section>
      </div>
    </div>
  );
}
