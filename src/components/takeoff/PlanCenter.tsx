"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
import { PlanSetFormModal } from "@/components/takeoff/PlanSetFormModal";
import { Button } from "@/components/ui/Button";
import {
  createPlanSet,
  fetchPlanSets,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type { CreatePlanSetInput, PlanSetListItem } from "@/lib/takeoff/types";

type PlanCenterProps = {
  versionId: string;
};

function formatTotalSize(sets: PlanSetListItem[]) {
  // We don't have total_size_bytes on the set list — show file count only
  const totalFiles = sets.reduce((acc, s) => acc + s.file_count, 0);
  return totalFiles;
}

function SkeletonCard() {
  return (
    <div className="dashboard-card animate-pulse p-5">
      <div className="flex items-center gap-4">
        <div className="h-5 w-48 rounded bg-[var(--slate-200)]" />
        <div className="ml-auto h-4 w-24 rounded bg-[var(--slate-200)]" />
      </div>
      <div className="mt-3 h-4 w-32 rounded bg-[var(--slate-200)]" />
    </div>
  );
}

export function PlanCenter({ versionId }: PlanCenterProps) {
  const swrKey = `plan-sets:${versionId}`;

  const {
    data: sets,
    error,
    isLoading,
    mutate,
  } = useSWR<PlanSetListItem[]>(swrKey, () => fetchPlanSets(versionId), {
    revalidateOnFocus: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const handleCreateSet = useCallback(
    async (input: Pick<CreatePlanSetInput, "name" | "description">) => {
      setCreating(true);
      setCreateError(null);
      try {
        await createPlanSet({
          estimate_version_id: versionId,
          name: input.name,
          description: input.description,
        });
        await mutate();
        setModalOpen(false);
        setAnnouncement(`Jeu de plans "${input.name}" cree.`);
      } catch (err) {
        const msg = isTakeoffApiError(err)
          ? err.message
          : "Impossible de creer le jeu de plans.";
        setCreateError(msg);
      } finally {
        setCreating(false);
      }
    },
    [versionId, mutate]
  );

  const handleSetDeleted = useCallback(() => {
    mutate();
  }, [mutate]);

  const handleFilesChanged = useCallback(() => {
    mutate();
  }, [mutate]);

  const handleSetUpdated = useCallback(() => {
    mutate();
  }, [mutate]);

  /* Metrics */
  const totalSets = sets?.length ?? 0;
  const totalFiles = sets ? formatTotalSize(sets) : 0;

  return (
    <section>
      {/* Metrics bar */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-6 text-sm text-[var(--slate-600)]">
          <span>
            <strong className="text-[var(--slate-800)]">{totalSets}</strong>{" "}
            {totalSets === 1 ? "jeu" : "jeux"}
          </span>
          <span>
            <strong className="text-[var(--slate-800)]">{totalFiles}</strong>{" "}
            {totalFiles === 1 ? "fichier" : "fichiers"} au total
          </span>
        </div>
      )}

      {/* Action bar */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div />
        <Button
          size="sm"
          onClick={() => {
            setCreateError(null);
            setModalOpen(true);
          }}
        >
          Creer un jeu de plans
        </Button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="alert alert-error" role="alert">
          <p>
            {isTakeoffApiError(error)
              ? error.message
              : "Impossible de charger les jeux de plans."}
          </p>
          <button
            type="button"
            className="mt-2 text-sm font-semibold underline"
            onClick={() => mutate()}
          >
            Reessayer
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && sets && sets.length === 0 && (
        <div className="dashboard-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <svg
            className="mb-4 h-12 w-12 text-[var(--slate-300)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V8.25a2.25 2.25 0 00-2.25-2.25h-5.38a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
          <h3 className="text-base font-semibold text-[var(--slate-800)]">
            Aucun jeu de plans
          </h3>
          <p className="mt-2 max-w-sm text-sm text-[var(--slate-500)]">
            Un jeu de plans regroupe vos fichiers PDF pour une extraction.
            Commencez par en creer un.
          </p>
          <Button
            className="mt-6"
            size="sm"
            onClick={() => {
              setCreateError(null);
              setModalOpen(true);
            }}
          >
            Creer mon premier jeu de plans
          </Button>
        </div>
      )}

      {/* Set list */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="space-y-4">
          {sets.map((set) => (
            <PlanSetCard
              key={set.id}
              planSet={set}
              versionId={versionId}
              onDeleted={handleSetDeleted}
              onFilesChanged={handleFilesChanged}
              onUpdated={handleSetUpdated}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <PlanSetFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreateSet}
        loading={creating}
        error={createError}
      />

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
