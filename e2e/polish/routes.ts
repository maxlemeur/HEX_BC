export type PolishFixtureKey =
  | "projectId"
  | "versionId"
  | "orderId"
  | "takeoffProjectId"
  | "takeoffVersionId"
  | "takeoffJobId"
  | "portalToken";

export type PolishRoute = {
  id: string;
  /** Path template; `:key` segments are replaced by resolved fixtures. */
  path: string;
  /** Expected visible h1. `null` while the lot that owns the screen has not fixed it yet. */
  heading: string | RegExp | null;
  tags: string[];
  auth?: "user" | "anon";
  /** CSS selectors excluded from the blocking axe pass (frozen editor grid). */
  axeExclude?: string[];
};

const FROZEN_GRID = ['[data-testid="estimate-editor-table-shell"]'];

export const POLISH_ROUTES: PolishRoute[] = [
  // Accueil et affaires
  { id: "home", path: "/dashboard", heading: "Vue d’ensemble", tags: ["home"] },
  { id: "affaires", path: "/dashboard/affaires", heading: "Affaires", tags: ["affaires"] },
  { id: "affaires-new", path: "/dashboard/affaires/new", heading: null, tags: ["affaires"] },
  { id: "affaire-hub", path: "/dashboard/affaires/:projectId", heading: null, tags: ["affaires"] },
  { id: "affaire-plans", path: "/dashboard/affaires/:projectId/plans", heading: null, tags: ["affaires", "takeoff"] },
  { id: "affaire-prices", path: "/dashboard/affaires/:projectId/prices", heading: null, tags: ["affaires", "tarifs"] },
  { id: "affaire-takeoff", path: "/dashboard/affaires/:takeoffProjectId/takeoff", heading: null, tags: ["affaires", "takeoff"] },
  {
    id: "affaire-takeoff-review",
    path: "/dashboard/affaires/:takeoffProjectId/takeoff/:takeoffJobId/review?versionId=:takeoffVersionId",
    heading: null,
    tags: ["takeoff"],
  },

  // Devis
  { id: "estimate-new", path: "/dashboard/estimates/new?projectId=:projectId", heading: null, tags: ["estimates"] },
  { id: "estimate-detail", path: "/dashboard/estimates/:versionId", heading: null, tags: ["estimates"] },
  { id: "estimate-edit", path: "/dashboard/estimates/:versionId/edit", heading: null, tags: ["estimates", "editor"], axeExclude: FROZEN_GRID },
  { id: "estimate-diff", path: "/dashboard/estimates/:versionId/diff", heading: null, tags: ["estimates"] },
  { id: "estimate-print", path: "/dashboard/estimates/:versionId/print", heading: null, tags: ["estimates"] },
  { id: "estimate-templates", path: "/dashboard/estimates/templates", heading: null, tags: ["estimates"] },
  { id: "estimate-assemblies", path: "/dashboard/estimates/assemblies", heading: null, tags: ["estimates", "referentiel"] },

  // Métré (routes legacy comprises)
  { id: "takeoff-legacy-home", path: "/dashboard/takeoff", heading: null, tags: ["takeoff", "legacy"] },
  { id: "takeoff-legacy-plans", path: "/dashboard/estimates/:takeoffVersionId/plans", heading: null, tags: ["takeoff", "legacy"] },
  { id: "takeoff-legacy-jobs", path: "/dashboard/estimates/:takeoffVersionId/takeoff", heading: null, tags: ["takeoff", "legacy"] },
  { id: "takeoff-legacy-new", path: "/dashboard/estimates/:takeoffVersionId/takeoff/new", heading: null, tags: ["takeoff", "legacy"] },
  { id: "takeoff-legacy-job", path: "/dashboard/estimates/:takeoffVersionId/takeoff/:takeoffJobId", heading: null, tags: ["takeoff", "legacy"] },
  {
    id: "takeoff-legacy-review",
    path: "/dashboard/estimates/:takeoffVersionId/takeoff/:takeoffJobId/review",
    heading: null,
    tags: ["takeoff", "legacy"],
  },

  // Commandes
  { id: "orders", path: "/dashboard/orders", heading: null, tags: ["orders"] },
  { id: "orders-new", path: "/dashboard/orders/new", heading: null, tags: ["orders"] },
  { id: "order-detail", path: "/dashboard/orders/:orderId", heading: null, tags: ["orders"] },
  { id: "order-edit", path: "/dashboard/orders/:orderId/edit", heading: null, tags: ["orders"] },
  { id: "order-print", path: "/dashboard/orders/:orderId/print", heading: null, tags: ["orders"] },

  // Référentiel, tarifs, DPGF
  { id: "referentiel", path: "/dashboard/referentiel", heading: null, tags: ["referentiel"] },
  { id: "suppliers", path: "/dashboard/suppliers", heading: null, tags: ["referentiel"] },
  { id: "sites", path: "/dashboard/sites", heading: null, tags: ["referentiel"] },
  { id: "products", path: "/dashboard/products", heading: null, tags: ["referentiel"] },
  { id: "tarifs", path: "/dashboard/tarifs", heading: null, tags: ["tarifs"] },
  { id: "prices", path: "/dashboard/prices", heading: "Prix fournisseurs", tags: ["tarifs"] },
  { id: "indices", path: "/dashboard/indices", heading: null, tags: ["tarifs"] },
  { id: "imports", path: "/dashboard/imports", heading: null, tags: ["dpgf"] },
  { id: "mappings", path: "/dashboard/mappings", heading: null, tags: ["dpgf"] },
  { id: "catalogue", path: "/dashboard/catalogue", heading: null, tags: ["dpgf"] },

  // Validation et pilotage
  { id: "approvals", path: "/dashboard/approvals", heading: null, tags: ["pilotage"] },
  { id: "direction", path: "/dashboard/direction", heading: null, tags: ["pilotage"] },
  { id: "analytics", path: "/dashboard/analytics", heading: null, tags: ["pilotage"] },

  // Administration et compte
  { id: "admin", path: "/dashboard/admin", heading: null, tags: ["admin"] },
  { id: "admin-rules", path: "/dashboard/admin/rules", heading: null, tags: ["admin"] },
  { id: "admin-procurement-reset", path: "/dashboard/admin/procurement-reset", heading: null, tags: ["admin"] },
  { id: "admin-flags", path: "/dashboard/admin/flags", heading: "Fonctionnalités", tags: ["admin"] },
  { id: "admin-currencies", path: "/dashboard/admin/currencies", heading: null, tags: ["admin"] },
  { id: "admin-suggestion-learning", path: "/dashboard/admin/suggestion-learning", heading: null, tags: ["admin"] },
  { id: "admin-anomaly-history", path: "/dashboard/admin/anomaly-history", heading: "Historique des anomalies", tags: ["admin"] },
  { id: "admin-mapping-rules", path: "/dashboard/admin/takeoff/mapping-rules", heading: null, tags: ["admin", "takeoff"] },
  { id: "admin-takeoff-metrics", path: "/dashboard/admin/takeoff/metrics", heading: null, tags: ["admin", "takeoff"] },
  { id: "tenants", path: "/dashboard/tenants", heading: null, tags: ["admin"] },
  { id: "memberships", path: "/dashboard/memberships", heading: null, tags: ["admin"] },
  { id: "profile", path: "/dashboard/profile", heading: null, tags: ["account"] },

  // Public
  { id: "login", path: "/login", heading: null, tags: ["public"], auth: "anon" },
  { id: "signup", path: "/signup", heading: null, tags: ["public"], auth: "anon" },
  { id: "portal", path: "/portal/:portalToken", heading: null, tags: ["portal"], auth: "anon" },
  { id: "portal-expired", path: "/portal/polish-audit-token/expired", heading: null, tags: ["portal"], auth: "anon" },
  { id: "portal-invalid", path: "/portal/polish-audit-invalid-token", heading: null, tags: ["portal"], auth: "anon" },
];

export const POLISH_VIEWPORTS = [
  { name: "320", width: 320, height: 568 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

export function routeFixtureKeys(route: PolishRoute): PolishFixtureKey[] {
  return [...route.path.matchAll(/:([A-Za-z]+)/g)].map(
    (match) => match[1] as PolishFixtureKey
  );
}

export function resolveRoutePath(
  route: PolishRoute,
  fixtures: Partial<Record<PolishFixtureKey, string>>
): string | null {
  let missing = false;
  const resolved = route.path.replace(/:([A-Za-z]+)/g, (_, key: PolishFixtureKey) => {
    const value = fixtures[key];
    if (!value) {
      missing = true;
      return "";
    }
    return encodeURIComponent(value);
  });
  return missing ? null : resolved;
}
