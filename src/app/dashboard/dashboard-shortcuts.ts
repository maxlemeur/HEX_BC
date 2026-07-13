import type { TenantRole } from "@/lib/navigation/build-nav-groups";
import type { UiMode } from "@/lib/ui-mode";

export type DashboardShortcut = {
  href: string;
  label: string;
  description: string;
};

export function buildDashboardShortcuts(
  role: TenantRole | null,
  uiMode: UiMode
): DashboardShortcut[] {
  const shortcuts: DashboardShortcut[] = [
    {
      href: "/dashboard/affaires",
      label: "Affaires",
      description: "Suivre les dossiers de chiffrage",
    },
    {
      href: "/dashboard/orders",
      label: "Commandes",
      description: "Consulter les bons de commande",
    },
  ];

  if (role === "admin" || role === "director") {
    shortcuts.push(
      {
        href: "/dashboard/approvals",
        label: "Approbations",
        description: "Traiter les validations en attente",
      },
      {
        href: "/dashboard/direction",
        label: "Vue direction",
        description: "Piloter le portefeuille et les risques",
      }
    );
  }

  if (role === "admin" || (role === "engineer" && uiMode === "expert")) {
    shortcuts.push({
      href: "/dashboard/analytics",
      label: "Performances",
      description: "Analyser l’activité de chiffrage",
    });
  }

  if (role === "admin") {
    shortcuts.push({
      href: "/dashboard/admin",
      label: "Administration",
      description: "Configurer la plateforme",
    });
  }

  return shortcuts;
}
