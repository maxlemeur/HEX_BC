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
};

export default function TakeoffApplicationHistoryTab({ projectId }: Props) {
  const { data, isLoading } = useSWR(
    ["history-applied-jobs", projectId],
    () => listTakeoffJobs({ project_id: projectId, status: "applied" })
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
    <div className="dashboard-card overflow-x-auto">
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
  );
}
