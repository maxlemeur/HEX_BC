"use client";

import Link from "next/link";
import useSWR from "swr";

import { listTakeoffJobs } from "@/lib/takeoff/client";
import { EmptyState } from "@/components/layout/empty-state";
import {
  formatTimestamp,
  formatCount,
  JobsTableSkeleton,
} from "./takeoff-job-list-shared";
import { ClockIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

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
        headingLevel={2}
        icon={<ClockIcon aria-hidden="true" />}
        title="Aucune application"
        description="Aucune extraction n’a encore été appliquée au devis."
      />
    );
  }

  return (
    <>
      <div className="space-y-3 sm:hidden">
        {jobs.map((job) => (
          <article
            key={job.id}
            className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {job.version_number != null ? `Version V${job.version_number}` : "Version"}
                </p>
                <p className="mt-1 break-words text-sm font-semibold text-foreground">
                  {job.source_file_name ?? "Fichier inconnu"}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-secondary">
                {formatCount(job.items_count)} item{job.items_count === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Appliqué le {formatTimestamp(job.created_at)}
            </p>
            <Link
              href={`/dashboard/estimates/${job.estimate_version_id}/takeoff/${job.id}`}
              className={cn(buttonVariants({ variant: "outline" }), "mt-4 w-full justify-center")}
            >
              Voir le détail
            </Link>
          </article>
        ))}
      </div>

      <Card
        className="relative hidden overflow-x-auto sm:block"
        role="region"
        aria-label="Historique des applications"
        tabIndex={0}
      >
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
                  className={buttonVariants({ variant: "outline" })}
                >
                  Détail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </Card>
    </>
  );
}
