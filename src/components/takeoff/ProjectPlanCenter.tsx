"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import {
  createPlanSetAction,
  deletePlanSetAction,
} from "@/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets";
import { formatFileSize } from "@/components/takeoff/PlanFileCard";
import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
import { PlanSetFormModal } from "@/components/takeoff/PlanSetFormModal";
import { Button } from "@/components/ui/Button";
import {
  fetchPlanSetsForProject,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type { CreatePlanSetInput, PlanSetListItem } from "@/lib/takeoff/types";

type ProjectPlanCenterProps = {
  projectId: string;
  initialPlanSets?: PlanSetListItem[];
};

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

export function ProjectPlanCenter({ projectId, initialPlanSets }: ProjectPlanCenterProps) {
  const swrKey = `plan-sets-project:${projectId}`;

  const {
    data: sets,
    error,
    isLoading,
    mutate,
  } = useSWR<PlanSetListItem[]>(swrKey, () => fetchPlanSetsForProject(projectId), {
    revalidateOnFocus: false,
    fallbackData: initialPlanSets,
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
        await createPlanSetAction({
          project_id: projectId,
          name: input.name,
          description: input.description,
        });
        await mutate();
        setModalOpen(false);
        setAnnouncement(`Jeu de plans "${input.name}" créé.`);
      } catch (err) {
        const msg = isTakeoffApiError(err)
          ? err.message
          : "Impossible de créer le jeu de plans.";
        setCreateError(msg);
      } finally {
        setCreating(false);
      }
    },
    [projectId, mutate]
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
  const totalFiles = sets
    ? sets.reduce((acc, s) => acc + s.file_count, 0)
    : 0;
  const totalSizeBytes = sets
    ? sets.reduce((acc, s) => acc + s.total_size_bytes, 0)
    : 0;

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
          <span>
            <strong className="text-[var(--slate-800)]">{formatFileSize(totalSizeBytes)}</strong>{" "}
            au total
          </span>
        </div>
      )}

      {/* Action bar */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="mb-6 flex justify-stretch sm:justify-end">
          <Button
            className="h-11 w-full sm:h-8 sm:w-auto"
            size="sm"
            onClick={() => {
              setCreateError(null);
              setModalOpen(true);
            }}
          >
            Créer un jeu de plans
          </Button>
        </div>
      )}

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
            Réessayer
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && sets && sets.length === 0 && (
        <div className="dashboard-card flex flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-16">
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
            Un jeu de plans regroupe vos fichiers PDF pour le métré.
            Commencez par en créer un.
          </p>
          <Button
            className="mt-6 h-11 w-full sm:h-8 sm:w-auto"
            size="sm"
            onClick={() => {
              setCreateError(null);
              setModalOpen(true);
            }}
          >
            Créer mon premier jeu de plans
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
              versionId={null}
              deletePlanSetHandler={deletePlanSetAction}
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
