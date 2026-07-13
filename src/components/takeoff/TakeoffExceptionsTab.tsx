"use client";

import Link from "next/link";
import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import {
  fetchTakeoffRiskRadar,
  listTakeoffJobs,
} from "@/lib/takeoff/client";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { JobsTableSkeleton } from "./takeoff-job-list-shared";

type Props = {
  projectId: string;
  versionId?: string | null;
};

const SEVERITY_LABELS = {
  all: "Toutes severites",
  info: "Info",
  warning: "Attention",
  critical: "Critique",
} as const;

const STATUS_LABELS = {
  all: "Tous statuts",
  to_process: "A traiter",
  assumed: "Assume",
  false_positive: "Faux positif",
} as const;

const SEVERITY_VARIANTS = {
  info: "info",
  warning: "warning",
  critical: "error",
} as const;

const STATUS_VARIANTS = {
  to_process: "warning",
  assumed: "success",
  false_positive: "neutral",
} as const;

function findLatestReviewableJob(
  jobs: Awaited<ReturnType<typeof listTakeoffJobs>>["jobs"] | undefined
) {
  return (
    jobs?.find((job) => job.status === "completed" || job.status === "applied") ?? null
  );
}

export default function TakeoffExceptionsTab({ projectId, versionId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isFilterPending, startFilterTransition] = useTransition();

  const severityFilter =
    (searchParams.get("riskSeverity") as
      | "all"
      | "info"
      | "warning"
      | "critical"
      | null) ?? "all";
  const statusFilter =
    (searchParams.get("riskStatus") as
      | "all"
      | "to_process"
      | "assumed"
      | "false_positive"
      | null) ?? "to_process";

  const updateFilters = useCallback(
    (updates: {
      riskSeverity?: "all" | "info" | "warning" | "critical";
      riskStatus?:
        | "all"
        | "to_process"
        | "assumed"
        | "false_positive";
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (updates.riskSeverity) {
        if (updates.riskSeverity === "all") {
          params.delete("riskSeverity");
        } else {
          params.set("riskSeverity", updates.riskSeverity);
        }
      }

      if (updates.riskStatus) {
        if (updates.riskStatus === "to_process") {
          params.delete("riskStatus");
        } else {
          params.set("riskStatus", updates.riskStatus);
        }
      }

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const { data: jobsData } = useSWR(
    ["exceptions-latest-job", projectId, versionId ?? "latest"],
    () =>
      listTakeoffJobs({
        ...(versionId
          ? { estimate_version_id: versionId }
          : { project_id: projectId }),
        limit: 20,
      })
  );

  const latestJob = findLatestReviewableJob(jobsData?.jobs);

  const { data: radarData, isLoading } = useSWR(
    latestJob
      ? [
          "exceptions-risk-radar",
          latestJob.id,
          latestJob.estimate_version_id,
          severityFilter,
          statusFilter,
        ]
      : null,
    () =>
      latestJob
        ? fetchTakeoffRiskRadar(latestJob.id, {
            version_id: latestJob.estimate_version_id,
            severity: severityFilter !== "all" ? severityFilter : null,
            status: statusFilter !== "all" ? statusFilter : null,
          })
        : null
  );

  if (isLoading || (!jobsData && !latestJob)) {
    return <JobsTableSkeleton />;
  }

  if (!latestJob || !radarData || radarData.items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        }
        title="Aucune exception"
        description="Aucun signal de risque ne remonte pour cette version."
      />
    );
  }

  const { summary } = radarData;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <Badge variant="warning">{summary.to_process_count} a traiter</Badge>
        <Badge variant="success">{summary.assumed_count} assumes</Badge>
        <Badge variant="error">{summary.critical_count} critiques</Badge>
        <Badge variant="info">Score affaire {summary.project_score}/100</Badge>
        <Badge variant="neutral">
          {summary.top_causes.length > 0
            ? summary.top_causes.join(" · ")
            : "Aucune cause dominante"}
        </Badge>
      </div>

      <section className="dashboard-card mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end lg:flex lg:flex-wrap">
          <div className="min-w-0">
            <label htmlFor="exceptions-severity-filter" className="form-label">
              Severite
            </label>
            <select
              id="exceptions-severity-filter"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[180px]"
              value={severityFilter}
              onChange={(event) => {
                const nextValue = event.target.value as typeof severityFilter;
                startFilterTransition(() => {
                  updateFilters({ riskSeverity: nextValue });
                });
              }}
            >
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="exceptions-status-filter" className="form-label">
              Statut
            </label>
            <select
              id="exceptions-status-filter"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[180px]"
              value={statusFilter}
              onChange={(event) => {
                const nextValue = event.target.value as typeof statusFilter;
                startFilterTransition(() => {
                  updateFilters({ riskStatus: nextValue });
                });
              }}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-[var(--slate-500)] sm:col-span-2 lg:col-span-1">
            {radarData.items.length} signal(s)
            {isFilterPending ? " · filtrage..." : ""}
          </p>
        </div>
      </section>

      <div className="space-y-3 sm:hidden">
        {radarData.items.map((item) => (
          <article
            key={item.alert_id}
            className="rounded-2xl border border-[var(--slate-200)] bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)]">
                {item.scope_label}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant={SEVERITY_VARIANTS[item.severity]} size="sm">
                  {SEVERITY_LABELS[item.severity]}
                </Badge>
                <Badge variant={STATUS_VARIANTS[item.status]} size="sm">
                  {STATUS_LABELS[item.status]}
                </Badge>
              </div>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-[var(--slate-900)]">
              {item.cause_label}
            </h3>
            {item.reason_labels[0] ? (
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                {item.reason_labels[0]}
              </p>
            ) : null}
            {item.provenance[0] ? (
              <p className="mt-3 text-xs text-[var(--slate-500)]">
                {item.provenance[0].label} · {item.provenance[0].source}
              </p>
            ) : null}
            {item.line_id ? (
              <Link
                href={`/dashboard/affaires/${projectId}/takeoff/${latestJob.id}/review?versionId=${latestJob.estimate_version_id}&line=${item.line_id}`}
                className="btn btn-secondary btn-sm mt-4 w-full justify-center"
              >
                Revoir ce signal
              </Link>
            ) : (
              <p className="mt-3 text-xs font-medium text-[var(--slate-500)]">
                Signal au niveau de l&apos;affaire
              </p>
            )}
          </article>
        ))}
      </div>

      <section className="dashboard-card hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Cause</th>
                <th>Severite</th>
                <th>Statut</th>
                <th>Provenance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {radarData.items.map((item) => (
                <tr key={item.alert_id}>
                  <td className="font-medium text-[var(--slate-800)]">
                    {item.scope_label}
                  </td>
                  <td>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-[var(--slate-900)]">
                        {item.cause_label}
                      </p>
                      {item.reason_labels[0] ? (
                        <p className="text-xs text-[var(--slate-500)]">
                          {item.reason_labels[0]}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Badge variant={SEVERITY_VARIANTS[item.severity]} size="sm">
                      {SEVERITY_LABELS[item.severity]}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={STATUS_VARIANTS[item.status]} size="sm">
                      {STATUS_LABELS[item.status]}
                    </Badge>
                  </td>
                  <td>
                    {item.provenance[0] ? (
                      <div className="text-xs text-[var(--slate-600)]">
                        <p>{item.provenance[0].label}</p>
                        <p className="text-[var(--slate-500)]">
                          {item.provenance[0].source}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[var(--slate-400)]">-</span>
                    )}
                  </td>
                  <td>
                    {item.line_id ? (
                      <Link
                        href={`/dashboard/affaires/${projectId}/takeoff/${latestJob.id}/review?versionId=${latestJob.estimate_version_id}&line=${item.line_id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Revoir
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--slate-400)]">
                        Vue affaire
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
