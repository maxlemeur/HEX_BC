import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDiffView } from "@/components/estimates/EstimateDiffView";
import {
  buildEstimateDiff,
  normalizeEstimateDiffMode,
  type EstimateDiffMode,
} from "@/lib/estimates/diff";
import { getEstimateVersionDetails } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

type DiffPageProps = {
  params?: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type VersionSelectorOption = Pick<
  EstimateVersionRow,
  "id" | "version_number" | "title" | "status" | "updated_at"
>;

const COMPARE_OPTIONS_PAGE_SIZE = 20;

function pickQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const trimmed = entry.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function parsePositiveIntegerQuery(
  value: string | null,
  fallback: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function normalizeCompareSearch(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 80);
}

function parseVersionSearch(value: string | null): number | null {
  if (!value) return null;
  const match = /^v?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function statusLabel(status: EstimateStatus) {
  if (status === "draft") return "Brouillon";
  if (status === "sent") return "Envoye";
  if (status === "accepted") return "Accepte";
  if (status === "archived") return "Archive";
  return status;
}

function formatDate(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatVersionLabel(input: {
  version_number: number;
  title: string | null;
}) {
  const baseLabel = `V${input.version_number}`;
  if (!input.title || input.title.trim().length === 0) return baseLabel;
  return `${baseLabel} - ${input.title.trim()}`;
}

function buildModeHref(input: {
  versionId: string;
  compareId: string | null;
  mode: EstimateDiffMode;
  comparePage: number;
  compareSearch: string | null;
}) {
  const query = new URLSearchParams();
  if (input.compareId) {
    query.set("compare", input.compareId);
  }
  query.set("mode", input.mode);
  if (input.comparePage > 1) {
    query.set("comparePage", String(input.comparePage));
  }
  if (input.compareSearch) {
    query.set("compareSearch", input.compareSearch);
  }
  return `/dashboard/estimates/${input.versionId}/diff?${query.toString()}`;
}

export default async function EstimateDiffPage({
  params,
  searchParams,
}: DiffPageProps) {
  if (!params) {
    notFound();
  }

  const { versionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const compareParam = pickQueryValue(resolvedSearchParams?.compare);
  const mode = normalizeEstimateDiffMode(pickQueryValue(resolvedSearchParams?.mode));
  const comparePageRequested = parsePositiveIntegerQuery(
    pickQueryValue(resolvedSearchParams?.comparePage),
    1
  );
  const compareSearch = normalizeCompareSearch(
    pickQueryValue(resolvedSearchParams?.compareSearch)
  );
  const versionSearch = parseVersionSearch(compareSearch);

  const currentDetails = await getEstimateVersionDetails(versionId);
  const supabase = await createSupabaseServerClient();

  let compareCountQuery = supabase
    .from("estimate_versions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", currentDetails.version.tenant_id)
    .eq("project_id", currentDetails.version.project_id)
    .neq("id", versionId);

  if (versionSearch !== null) {
    compareCountQuery = compareCountQuery.eq("version_number", versionSearch);
  } else if (compareSearch) {
    compareCountQuery = compareCountQuery.ilike("title", `%${compareSearch}%`);
  }

  const { count: compareTotalCountRaw, error: compareCountError } =
    await compareCountQuery;
  if (compareCountError) {
    notFound();
  }

  const compareTotalCount = compareTotalCountRaw ?? 0;
  const compareTotalPages = Math.max(
    1,
    Math.ceil(compareTotalCount / COMPARE_OPTIONS_PAGE_SIZE)
  );
  const comparePage = Math.min(comparePageRequested, compareTotalPages);
  const compareRangeStart = (comparePage - 1) * COMPARE_OPTIONS_PAGE_SIZE;
  const compareRangeEnd = compareRangeStart + COMPARE_OPTIONS_PAGE_SIZE - 1;

  let compareOptionsQuery = supabase
    .from("estimate_versions")
    .select("id, version_number, title, status, updated_at")
    .eq("tenant_id", currentDetails.version.tenant_id)
    .eq("project_id", currentDetails.version.project_id)
    .neq("id", versionId);

  if (versionSearch !== null) {
    compareOptionsQuery = compareOptionsQuery.eq("version_number", versionSearch);
  } else if (compareSearch) {
    compareOptionsQuery = compareOptionsQuery.ilike("title", `%${compareSearch}%`);
  }

  const versionsResult = await compareOptionsQuery
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(compareRangeStart, compareRangeEnd);

  if (versionsResult.error || !versionsResult.data) {
    notFound();
  }

  const compareOptionsPage = (versionsResult.data ?? []) as VersionSelectorOption[];
  let selectedCompareOption: VersionSelectorOption | null = null;
  if (compareParam) {
    const selectedCompareResult = await supabase
      .from("estimate_versions")
      .select("id, version_number, title, status, updated_at")
      .eq("tenant_id", currentDetails.version.tenant_id)
      .eq("project_id", currentDetails.version.project_id)
      .eq("id", compareParam)
      .maybeSingle();

    if (selectedCompareResult.error) {
      notFound();
    }

    if (
      selectedCompareResult.data &&
      selectedCompareResult.data.id !== versionId
    ) {
      selectedCompareOption = selectedCompareResult.data as VersionSelectorOption;
    }
  }

  const compareOptions = selectedCompareOption
    ? [
        selectedCompareOption,
        ...compareOptionsPage.filter(
          (version) => version.id !== selectedCompareOption?.id
        ),
      ]
    : compareOptionsPage;
  const hasCompareOptions = compareOptions.length > 0;
  const compareParamIsInvalid =
    compareParam !== null && !selectedCompareOption;

  const compareId = selectedCompareOption?.id ?? compareOptions[0]?.id ?? null;
  const compareVersionOption = compareOptions.find((version) => version.id === compareId);
  const compareVisibleStart =
    compareTotalCount === 0 ? 0 : (comparePage - 1) * COMPARE_OPTIONS_PAGE_SIZE + 1;
  const compareVisibleEnd = Math.min(
    compareTotalCount,
    comparePage * COMPARE_OPTIONS_PAGE_SIZE
  );

  const previousDetails = compareId
    ? await getEstimateVersionDetails(compareId)
    : null;
  const diff = previousDetails
    ? buildEstimateDiff({
        previous: previousDetails,
        current: currentDetails,
      })
    : null;

  const currentVersionLabel = formatVersionLabel(currentDetails.version);
  const previousVersionLabel = previousDetails
    ? formatVersionLabel(compareVersionOption ?? previousDetails.version)
    : "Version precedente";

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Comparaison de versions</h1>
          <p className="page-description">
            {previousVersionLabel} -&gt; {currentVersionLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn btn-secondary btn-sm" href={`/dashboard/estimates/${versionId}`}>
            Retour version
          </Link>
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId}/edit`}
          >
            Editer
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates">
            Liste
          </Link>
        </div>
      </div>

      <section className="dashboard-card mb-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div>
              <label className="form-label mb-1" htmlFor="compareSearch">
                Recherche
              </label>
              <input
                className="form-input form-input--sm min-w-[220px]"
                defaultValue={compareSearch ?? ""}
                id="compareSearch"
                name="compareSearch"
                placeholder="Titre ou V12"
                type="text"
              />
            </div>
            <div>
              <label className="form-label mb-1" htmlFor="compare">
                Version a comparer
              </label>
              <select
                id="compare"
                name="compare"
                className="form-input form-select form-input--sm min-w-[260px]"
                defaultValue={compareId ?? ""}
                disabled={!hasCompareOptions}
              >
                {hasCompareOptions ? null : (
                  <option value="">Aucune autre version disponible</option>
                )}
                {compareOptions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {formatVersionLabel(version)} | {statusLabel(version.status)} |{" "}
                    {formatDate(version.updated_at)}
                  </option>
                ))}
              </select>
            </div>

            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="comparePage" value="1" />
            <button
              className="btn btn-secondary btn-sm"
              disabled={!hasCompareOptions}
              type="submit"
            >
              Comparer
            </button>
          </form>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--slate-500)]">
              Mode
            </span>
            <Link
              className={mode === "inline" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
              href={buildModeHref({
                versionId,
                compareId,
                mode: "inline",
                comparePage,
                compareSearch,
              })}
            >
              Inline
            </Link>
            <Link
              className={
                mode === "side-by-side"
                  ? "btn btn-primary btn-sm"
                  : "btn btn-secondary btn-sm"
              }
              href={buildModeHref({
                versionId,
                compareId,
                mode: "side-by-side",
                comparePage,
                compareSearch,
              })}
            >
              Side-by-side
            </Link>
          </div>
        </div>

        {compareTotalCount > COMPARE_OPTIONS_PAGE_SIZE ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--slate-500)]">
              Options {compareVisibleStart}-{compareVisibleEnd} sur{" "}
              {compareTotalCount}
            </p>
            <div className="flex items-center gap-2">
              {comparePage > 1 ? (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={buildModeHref({
                    versionId,
                    compareId,
                    mode,
                    comparePage: comparePage - 1,
                    compareSearch,
                  })}
                >
                  Prev
                </Link>
              ) : (
                <span className="btn btn-secondary btn-sm opacity-50">Prev</span>
              )}
              {comparePage < compareTotalPages ? (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={buildModeHref({
                    versionId,
                    compareId,
                    mode,
                    comparePage: comparePage + 1,
                    compareSearch,
                  })}
                >
                  Next
                </Link>
              ) : (
                <span className="btn btn-secondary btn-sm opacity-50">Next</span>
              )}
            </div>
          </div>
        ) : null}

        {compareParamIsInvalid ? (
          <p className="mt-3 text-xs text-[var(--warning)]">
            Le parametre compare est invalide ou inaccessible. La comparaison a
            bascule sur la version disponible la plus recente.
          </p>
        ) : null}
      </section>

      {!hasCompareOptions ? (
        <div className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
          Cette version n&apos;a pas d&apos;autre version du meme projet a comparer.
        </div>
      ) : null}

      {hasCompareOptions && diff ? (
        <EstimateDiffView
          diff={diff}
          mode={mode}
          previousVersionLabel={previousVersionLabel}
          currentVersionLabel={currentVersionLabel}
        />
      ) : null}
    </div>
  );
}
