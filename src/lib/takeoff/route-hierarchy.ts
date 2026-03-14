import { getAuthenticatedContext } from "@/lib/estimates/server";
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
      return "Ouvrir les affaires";
    case "estimate_plans_legacy":
      return "Ouvrir les plans affaire";
    case "estimate_review_legacy":
      return "Ouvrir la revue metres affaire";
    case "estimate_takeoff_legacy":
    case "estimate_launch_legacy":
    case "estimate_job_legacy":
      return "Revenir au cockpit affaire";
    default:
      return "Revenir a l'affaire";
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
    const provenanceLabel =
      input.kind === "affaire_plans"
        ? "Provenance du chemin : affaire-first / plans"
        : input.kind === "affaire_takeoff"
          ? "Provenance du chemin : affaire-first / centre metres"
          : "Provenance du chemin : affaire-first / revue metres";

    return {
      classification: "principal",
      badgeLabel: "Flux principal",
      title: "Parcours affaire prioritaire",
      description:
        "Vous etes dans le flux principal affaire-first. Les aides adjacentes restent secondaires, et le legacy estimate-first n'est qu'un fallback volontaire.",
      provenanceLabel,
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
      ? "Provenance du chemin : legacy estimate-first / portail takeoff"
      : input.kind === "estimate_plans_legacy"
      ? "Provenance du chemin : legacy estimate-first / plan center"
      : input.kind === "estimate_takeoff_legacy"
        ? "Provenance du chemin : legacy estimate-first / historique takeoff"
        : input.kind === "estimate_launch_legacy"
          ? "Provenance du chemin : legacy estimate-first / lancement takeoff"
          : input.kind === "estimate_job_legacy"
            ? "Provenance du chemin : legacy estimate-first / suivi job"
            : "Provenance du chemin : legacy estimate-first / revue";

  return {
    classification: "legacy",
    badgeLabel: "Legacy",
    title: "Fallback estimate-first explicite",
    description:
      "Vous etes dans une surface legacy estimate-first. Le flux principal reste l'affaire ; utilisez ce chemin seulement si vous reprenez un contexte existant ou un cas de fallback.",
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
    throw mapSupabaseError(error, "Impossible de resoudre le contexte affaire du takeoff.");
  }

  return {
    projectId: typeof data?.project_id === "string" ? data.project_id : null,
    versionNumber: typeof data?.version_number === "number" ? data.version_number : null,
  };
}
