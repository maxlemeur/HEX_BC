import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ChartNoAxesCombinedIcon, CircleCheckIcon, FolderIcon, PlusIcon, SettingsIcon, ShoppingCartIcon, TrendingUpIcon } from "lucide-react";

import { buildDashboardShortcuts } from "@/app/dashboard/dashboard-shortcuts";
import { DashboardAffaires } from "@/components/dashboard/DashboardAffaires";
import { buttonVariants } from "@/components/ui/button";
import { parseDashboardQuery } from "@/lib/affaires/dashboard-query";
import { fetchAffaireDashboardWorkspace } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Accueil" };

const SHORTCUT_ICONS = {
  "/dashboard/affaires": FolderIcon,
  "/dashboard/orders": ShoppingCartIcon,
  "/dashboard/approvals": CircleCheckIcon,
  "/dashboard/direction": ChartNoAxesCombinedIcon,
  "/dashboard/analytics": TrendingUpIcon,
  "/dashboard/admin": SettingsIcon,
};

export default async function DashboardPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const query = parseDashboardQuery(await searchParams);
  const [{ profile }, data] = await Promise.all([getUserContext(), fetchAffaireDashboardWorkspace(query)]);
  const role = profile?.tenant_role ?? null;
  const canCreateAffaire = role === "admin" || role === "engineer";
  const shortcuts = buildDashboardShortcuts(role, profile?.ui_mode ?? "simplified");

  const affaireAction = (
    <Link href={canCreateAffaire ? "/dashboard/affaires/new" : "/dashboard/affaires"} prefetch={false} className={`${buttonVariants({ variant: "primary", size: "md" })} w-full`}>
      {canCreateAffaire ? <><PlusIcon aria-hidden="true" /> Nouvelle affaire</> : "Voir les affaires"}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <h1 className="sr-only">Accueil</h1>
      <div className="mb-4 lg:hidden">{affaireAction}</div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <DashboardAffaires data={data} query={query} />
        <aside aria-label="Votre espace de travail" className="grid items-start gap-4">
          <div className="hidden lg:block">{affaireAction}</div>
          <section aria-labelledby="dashboard-shortcuts-heading" className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
            <h2 id="dashboard-shortcuts-heading" className="mb-2 text-base font-semibold text-foreground">Accès rapides</h2>
            <ul className="divide-y divide-border-subtle">
              {shortcuts.map(shortcut => {
                const Icon = SHORTCUT_ICONS[shortcut.href as keyof typeof SHORTCUT_ICONS] ?? FolderIcon;
                return <li key={shortcut.href}>
                  <Link href={shortcut.href} prefetch={false} title={shortcut.description} className="group flex min-h-12 items-center gap-3 rounded-md py-2 text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">{shortcut.label}</span>
                    <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
                  </Link>
                </li>;
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
