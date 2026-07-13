"use client";

import Link from "next/link";
import useSWR from "swr";

import { listTakeoffJobs } from "@/lib/takeoff/client";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatTimestamp,
  formatCount,
  JobsTableSkeleton,
} from "./takeoff-job-list-shared";

type Props = {
  projectId: string;
  versionId?: string | null;
};

export default function TakeoffApplicationHistoryTab({
  projectId,
  versionId,
}: Props) {
  const { data, isLoading } = useSWR(
    ["history-applied-jobs", projectId, versionId ?? "all"],
    () =>
      listTakeoffJobs({
        project_id: projectId,
        estimate_version_id: versionId ?? undefined,
        status: "applied",
      })
  );

  if (isLoading) return <JobsTableSkeleton />;

  const jobs = data?.jobs ?? [];

  if (jobs.length === 0) {
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
            <polyline points="12 8 12 12 14 14" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        }
        title="Aucune application"
        description="Aucune extraction n'a encore ete appliquee au devis."
      />
    );
  }

  return (
    <>
      <div className="space-y-3 sm:hidden">
        {jobs.map((job) => (
          <article
            key={job.id}
            className="rounded-2xl border border-[var(--slate-200)] bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  {job.version_number != null ? `Version V${job.version_number}` : "Version"}
                </p>
                <p className="mt-1 break-words text-sm font-semibold text-[var(--slate-900)]">
                  {job.source_file_name ?? "Fichier inconnu"}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-semibold text-[var(--slate-700)]">
                {formatCount(job.items_count)} item{job.items_count === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-3 text-xs text-[var(--slate-500)]">
              Applique le {formatTimestamp(job.created_at)}
            </p>
            <Link
              href={`/dashboard/estimates/${job.estimate_version_id}/takeoff/${job.id}`}
              className="btn btn-secondary btn-sm mt-4 w-full justify-center"
            >
              Voir le detail
            </Link>
          </article>
        ))}
      </div>

      <div className="dashboard-card hidden overflow-x-auto sm:block">
        <table className="data-table w-full">
        <thead>
          <tr>
            <th>Version</th>
            <th>Source</th>
            <th>Date d&apos;application</th>
            <th>Items</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                {job.version_number != null ? `V${job.version_number}` : "-"}
              </td>
              <td>{job.source_file_name ?? "Fichier inconnu"}</td>
              <td>{formatTimestamp(job.created_at)}</td>
              <td>{formatCount(job.items_count)}</td>
              <td>
                <Link
                  href={`/dashboard/estimates/${job.estimate_version_id}/takeoff/${job.id}`}
                  className="btn btn-secondary btn-sm"
                >
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  );
}
