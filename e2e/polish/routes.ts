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
  /** Expected visible h1 (exact string or pattern); `null` when the screen has no fixture. */
  heading: string | RegExp | null;
  /** HTTP status the route must answer; defaults to any status below 400. */
  expectedStatus?: number;
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
  { id: "affaires-new", path: "/dashboard/affaires/new", heading: "Nouvelle affaire", tags: ["affaires"] },
  { id: "affaire-hub", path: "/dashboard/affaires/:projectId", heading: /\S/, tags: ["affaires"] },
  {
    id: "affaire-plans",
    path: "/dashboard/affaires/:projectId/plans",
    heading: "Plans",
    tags: ["affaires", "takeoff"],
  },
  {
    id: "affaire-prices",
    path: "/dashboard/affaires/:projectId/prices",
    heading: "Prix fournisseurs",
    tags: ["affaires", "tarifs"],
  },
  {
    id: "affaire-takeoff",
    path: "/dashboard/affaires/:takeoffProjectId/takeoff",
    heading: "Centre d'activité — Métrés",
    tags: ["affaires", "takeoff"],
  },
  {
    id: "affaire-takeoff-review",
    path: "/dashboard/affaires/:takeoffProjectId/takeoff/:takeoffJobId/review?versionId=:takeoffVersionId",
    heading: "Revue des exceptions & preuves",
    tags: ["takeoff"],
  },

  // Devis
  {
    id: "estimate-new",
    path: "/dashboard/estimates/new?projectId=:projectId",
    heading: /^Nouve(au chiffrage|lle version)$/,
    tags: ["estimates"],
  },
  {
    id: "estimate-detail",
    path: "/dashboard/estimates/:versionId",
    heading: /^Chiffrage V\d+$/,
    tags: ["estimates"],
  },
  {
    id: "estimate-edit",
    path: "/dashboard/estimates/:versionId/edit",
    heading: "Éditer le chiffrage",
    tags: ["estimates", "editor"],
    axeExclude: FROZEN_GRID,
  },
  {
    id: "estimate-diff",
    path: "/dashboard/estimates/:versionId/diff",
    heading: "Comparaison de versions",
    tags: ["estimates"],
  },
  {
    id: "estimate-print",
    path: "/dashboard/estimates/:versionId/print",
    heading: "Aperçu avant impression",
    tags: ["estimates"],
  },
  {
    id: "estimate-templates",
    path: "/dashboard/estimates/templates",
    heading: "Modèles de chiffrage",
    tags: ["estimates"],
  },
  {
    id: "estimate-assemblies",
    path: "/dashboard/estimates/assemblies",
    heading: "Bibliothèque d'ouvrages",
    tags: ["estimates", "referentiel"],
  },

  // Métré (routes legacy comprises)
  {
    id: "takeoff-legacy-home",
    path: "/dashboard/takeoff",
    heading: "Métrés — Analyse de plans",
    tags: ["takeoff", "legacy"],
  },
  {
    id: "takeoff-legacy-plans",
    path: "/dashboard/estimates/:takeoffVersionId/plans",
    heading: "Plans",
    tags: ["takeoff", "legacy"],
  },
  {
    id: "takeoff-legacy-jobs",
    path: "/dashboard/estimates/:takeoffVersionId/takeoff",
    heading: "Historique des extractions",
    tags: ["takeoff", "legacy"],
  },
  {
    id: "takeoff-legacy-new",
    path: "/dashboard/estimates/:takeoffVersionId/takeoff/new",
    heading: "Lancer une extraction",
    tags: ["takeoff", "legacy"],
  },
  {
    id: "takeoff-legacy-job",
    path: "/dashboard/estimates/:takeoffVersionId/takeoff/:takeoffJobId",
    heading: "Extraction",
    tags: ["takeoff", "legacy"],
  },
  {
    id: "takeoff-legacy-review",
    path: "/dashboard/estimates/:takeoffVersionId/takeoff/:takeoffJobId/review",
    heading: "Revue d’extraction",
    tags: ["takeoff", "legacy"],
  },

  // Commandes
  { id: "orders", path: "/dashboard/orders", heading: "Bons de commande", tags: ["orders"] },
  { id: "orders-new", path: "/dashboard/orders/new", heading: "Nouveau bon de commande", tags: ["orders"] },
  { id: "order-detail", path: "/dashboard/orders/:orderId", heading: /^C-\d{4}-\d{3}$/, tags: ["orders"] },
  { id: "order-edit", path: "/dashboard/orders/:orderId/edit", heading: /^C-\d{4}-\d{3}$/, tags: ["orders"] },
  {
    id: "order-print",
    path: "/dashboard/orders/:orderId/print",
    heading: "Aperçu avant impression",
    tags: ["orders"],
  },

  // Référentiel, tarifs, DPGF
  { id: "referentiel", path: "/dashboard/referentiel", heading: "Référentiel", tags: ["referentiel"] },
  { id: "suppliers", path: "/dashboard/suppliers", heading: "Fournisseurs", tags: ["referentiel"] },
  { id: "sites", path: "/dashboard/sites", heading: "Chantiers", tags: ["referentiel"] },
  {
    id: "products",
    path: "/dashboard/products",
    heading: "Produits & prix de référence",
    tags: ["referentiel"],
  },
  { id: "tarifs", path: "/dashboard/tarifs", heading: "Tarifs", tags: ["tarifs"] },
  { id: "prices", path: "/dashboard/prices", heading: "Prix fournisseurs", tags: ["tarifs"] },
  { id: "indices", path: "/dashboard/indices", heading: "Indices matière", tags: ["tarifs"] },
  { id: "imports", path: "/dashboard/imports", heading: "Import DPGF", tags: ["dpgf"] },
  { id: "mappings", path: "/dashboard/mappings", heading: "Mapping DPGF", tags: ["dpgf"] },
  { id: "catalogue", path: "/dashboard/catalogue", heading: "Catalogue", tags: ["dpgf"] },

  // Validation et pilotage
  { id: "approvals", path: "/dashboard/approvals", heading: "Approbations", tags: ["pilotage"] },
  { id: "direction", path: "/dashboard/direction", heading: "Cockpit direction", tags: ["pilotage"] },
  { id: "analytics", path: "/dashboard/analytics", heading: "Performances", tags: ["pilotage"] },

  // Administration et compte
  { id: "admin", path: "/dashboard/admin", heading: "Administration", tags: ["admin"] },
  { id: "admin-rules", path: "/dashboard/admin/rules", heading: "Règles de contrôle", tags: ["admin"] },
  {
    id: "admin-procurement-reset",
    path: "/dashboard/admin/procurement-reset",
    heading: "Nettoyage des achats",
    tags: ["admin"],
  },
  { id: "admin-flags", path: "/dashboard/admin/flags", heading: "Fonctionnalités", tags: ["admin"] },
  { id: "admin-currencies", path: "/dashboard/admin/currencies", heading: "Taux de change", tags: ["admin"] },
  { id: "admin-calc-policy", path: "/dashboard/admin/calc-policy", heading: "Calcul des devis", tags: ["admin"] },
  {
    id: "admin-suggestion-learning",
    path: "/dashboard/admin/suggestion-learning",
    heading: "Apprentissage des suggestions",
    tags: ["admin"],
  },
  {
    id: "admin-anomaly-history",
    path: "/dashboard/admin/anomaly-history",
    heading: "Historique des anomalies",
    tags: ["admin"],
  },
  {
    id: "admin-mapping-rules",
    path: "/dashboard/admin/takeoff/mapping-rules",
    heading: "Règles d’enrichissement de l’extraction",
    tags: ["admin", "takeoff"],
  },
  {
    id: "admin-takeoff-metrics",
    path: "/dashboard/admin/takeoff/metrics",
    heading: "Suivi des métrés",
    tags: ["admin", "takeoff"],
  },
  { id: "tenants", path: "/dashboard/tenants", heading: "Organisation et membres", tags: ["admin"] },
  {
    id: "memberships",
    path: "/dashboard/memberships",
    heading: "Membres de l’organisation",
    tags: ["admin"],
  },
  { id: "profile", path: "/dashboard/profile", heading: "Mon profil", tags: ["account"] },

  // Public
  { id: "login", path: "/login", heading: "Connexion", tags: ["public"], auth: "anon" },
  { id: "signup", path: "/signup", heading: "Créer un compte", tags: ["public"], auth: "anon" },
  { id: "portal", path: "/portal/:portalToken", heading: null, tags: ["portal"], auth: "anon" },
  {
    id: "portal-expired",
    path: "/portal/polish-audit-token/expired",
    heading: "Devis expiré",
    tags: ["portal"],
    auth: "anon",
  },
  {
    id: "portal-invalid",
    path: "/portal/polish-audit-invalid-token",
    heading: "Lien de consultation invalide",
    tags: ["portal"],
    auth: "anon",
    expectedStatus: 404,
  },
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
