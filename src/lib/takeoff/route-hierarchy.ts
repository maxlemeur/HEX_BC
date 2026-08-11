import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";

export type TakeoffRouteHierarchyKind =
  | "dashboard_takeoff_legacy"
  | "affaire_plans"
  | "affaire_takeoff"
  | "affaire_review"
  | "estimate_plans_legacy"
  | "estimate_takeoff_legacy"
  | "estimate_launch_legacy"
  | "estimate_job_legacy"
  | "estimate_review_legacy";

export type TakeoffRouteHierarchyDescriptor = {
  classification: "principal" | "legacy";
  badgeLabel: string;
  title: string;
  description: string;
  provenanceLabel: string;
  targetHref: string | null;
  targetLabel: string | null;
};

type RouteHierarchySearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined | null>;

function toSearchParamsString(params?: RouteHierarchySearchParams | null) {
  if (!params) {
    return "";
  }

  if (params instanceof URLSearchParams) {
    return params.toString();
  }

  const normalized = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      normalized.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        normalized.append(key, entry);
      }
    }
  }

  return normalized.toString();
}

function buildLegacyTargetHref(input: {
  kind: TakeoffRouteHierarchyKind;
  projectId: string | null;
  versionId?: string | null;
  jobId?: string | null;
  searchParams?: RouteHierarchySearchParams | null;
}) {
  if (input.kind === "dashboard_takeoff_legacy") {
    return "/dashboard/affaires";
  }

  if (!input.projectId) {
    return "/dashboard/affaires";
  }

  if (input.kind === "estimate_plans_legacy") {
    return `/dashboard/affaires/${input.projectId}/plans`;
  }

  if (input.kind === "estimate_takeoff_legacy" || input.kind === "estimate_launch_legacy") {
    return `/dashboard/affaires/${input.projectId}`;
  }

  if (input.kind === "estimate_job_legacy") {
    return `/dashboard/affaires/${input.projectId}`;
  }

  if (input.kind === "estimate_review_legacy" && input.jobId && input.versionId) {
    const search = toSearchParamsString(input.searchParams);
    const reviewSearch = search.length > 0
      ? search
      : `versionId=${encodeURIComponent(input.versionId)}&view=dpgf&dpgfView=exceptions_only`;

    return `/dashboard/affaires/${input.projectId}/takeoff/${input.jobId}/review?${reviewSearch}`;
  }

  return `/dashboard/affaires/${input.projectId}/takeoff`;
}

function buildLegacyTargetLabel(input: { kind: TakeoffRouteHierarchyKind; targetHref: string | null }) {
  if (!input.targetHref) {
    return null;
  }

  switch (input.kind) {
    case "dashboard_takeoff_legacy":
      return "Choisir une affaire";
    case "estimate_plans_legacy":
      return "Ouvrir les plans de l’affaire";
    case "estimate_review_legacy":
      return "Ouvrir la revue du métré";
    case "estimate_takeoff_legacy":
    case "estimate_launch_legacy":
    case "estimate_job_legacy":
      return "Revenir à l’affaire";
    default:
      return "Revenir à l’affaire";
  }
}

export function buildTakeoffRouteHierarchy(input: {
  kind: TakeoffRouteHierarchyKind;
  projectId?: string | null;
  versionId?: string | null;
  jobId?: string | null;
  searchParams?: RouteHierarchySearchParams | null;
}): TakeoffRouteHierarchyDescriptor {
  if (
    input.kind === "affaire_plans" ||
    input.kind === "affaire_takeoff" ||
    input.kind === "affaire_review"
  ) {
    const routeCopy =
      input.kind === "affaire_plans"
        ? {
            title: "Préparer les plans de l’affaire",
            description:
              "Créez un jeu de plans, ajoutez les documents à analyser, puis lancez le métré depuis l’affaire.",
            provenanceLabel: "Étape : plans de l’affaire",
          }
        : input.kind === "affaire_takeoff"
          ? {
              title: "Suivre les métrés de l’affaire",
              description:
                "Consultez les analyses en cours ou terminées et reprenez les éléments qui demandent votre attention.",
              provenanceLabel: "Étape : suivi des analyses",
            }
          : {
              title: "Contrôler le métré avant intégration",
              description:
                "Vérifiez les quantités et les exceptions avant d’intégrer les éléments retenus au devis.",
              provenanceLabel: "Étape : revue du métré",
            };

    return {
      classification: "principal",
      badgeLabel: "Parcours recommandé",
      ...routeCopy,
      targetHref: null,
      targetLabel: null,
    };
  }

  const targetHref = buildLegacyTargetHref({
    kind: input.kind,
    projectId: input.projectId ?? null,
    versionId: input.versionId ?? null,
    jobId: input.jobId ?? null,
    searchParams: input.searchParams ?? null,
  });

  const provenanceLabel =
    input.kind === "dashboard_takeoff_legacy"
      ? "Repère : entrée générale des métrés existants"
      : input.kind === "estimate_plans_legacy"
      ? "Repère : plans rattachés à une version de devis"
      : input.kind === "estimate_takeoff_legacy"
        ? "Repère : historique d’une version de devis"
        : input.kind === "estimate_launch_legacy"
          ? "Repère : lancement depuis une version de devis"
          : input.kind === "estimate_job_legacy"
            ? "Repère : suivi d’une analyse existante"
            : "Repère : revue d’un métré existant";

  return {
    classification: "legacy",
    badgeLabel: "Ancien parcours",
    title: "Parcours conservé pour les dossiers existants",
    description:
      "Cette vue sert à reprendre un métré déjà rattaché à une version de devis. Pour un nouveau métré, partez des plans de l’affaire.",
    provenanceLabel,
    targetHref,
    targetLabel: buildLegacyTargetLabel({
      kind: input.kind,
      targetHref,
    }),
  };
}

export async function fetchTakeoffVersionProjectContext(versionId: string): Promise<{
  projectId: string | null;
  versionNumber: number | null;
}> {
  const context = await getAuthenticatedContext();

  let query = context.supabase
    .from("estimate_versions")
    .select("project_id, version_number, estimate_projects!inner(user_id)")
    .eq("tenant_id", context.tenantId)
    .eq("id", versionId)
    .limit(1);

  if (context.tenantRole !== "admin" && context.tenantRole !== "director") {
    query = query.eq("estimate_projects.user_id", context.userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de résoudre le contexte du métré.");
  }

  return {
    projectId: typeof data?.project_id === "string" ? data.project_id : null,
    versionNumber: typeof data?.version_number === "number" ? data.version_number : null,
  };
}
