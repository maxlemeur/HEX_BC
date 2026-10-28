"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import {
  createPlanSetAction,
  deletePlanSetAction,
} from "@/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets";
import { formatFileSize } from "@/components/takeoff/PlanFileCard";
import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
import { PlanDossierSyncNotice } from "@/components/takeoff/PlanDossierSyncNotice";
import { PlanSetFormModal } from "@/components/takeoff/PlanSetFormModal";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDelayedLoadingIndicator } from "@/hooks/useDelayedLoadingIndicator";
import {
  fetchPlanSetsForProject,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type { CreatePlanSetInput, PlanSetListItem } from "@/lib/takeoff/types";
import { FolderPlusIcon } from "lucide-react";

type ProjectPlanCenterProps = {
  projectId: string;
  initialPlanSets?: PlanSetListItem[];
};

function SkeletonCard() {
  return (
    <Card className="p-5" aria-hidden="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-5 w-48 max-w-[60%]" />
        <Skeleton className="ml-auto h-4 w-24" />
      </div>
      <Skeleton className="mt-3 h-4 w-32" />
    </Card>
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
    shouldRetryOnError: false,
  });
  const isSlowLoading = useDelayedLoadingIndicator(isLoading);

  const [modalOpen, setModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [unsynchronizedProjectId, setUnsynchronizedProjectId] = useState<string | null>(null);

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

  const handleSetDeleted = useCallback((projectId?: string) => {
    if (projectId) setUnsynchronizedProjectId(projectId);
    mutate();
  }, [mutate]);

  const handleFilesChanged = useCallback((projectId?: string) => {
    if (projectId) setUnsynchronizedProjectId(projectId);
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
      {unsynchronizedProjectId && <PlanDossierSyncNotice projectId={unsynchronizedProjectId} onSynchronized={() => { setUnsynchronizedProjectId(null); void mutate(); }} />}
      {/* Metrics bar */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">{totalSets}</strong>{" "}
            {totalSets === 1 ? "jeu" : "jeux"}
          </span>
          <span>
            <strong className="text-foreground">{totalFiles}</strong>{" "}
            {totalFiles === 1 ? "fichier" : "fichiers"} au total
          </span>
          {totalSizeBytes > 0 ? (
            <span>
              <strong className="text-foreground">
                {formatFileSize(totalSizeBytes)}
              </strong>{" "}
              au total
            </span>
          ) : null}
        </div>
      )}

      {/* Action bar */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="mb-6 flex justify-stretch sm:justify-end">
          <Button
            variant="primary"
            className="h-11 w-full sm:h-9 sm:w-auto"
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
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            {isSlowLoading
              ? "Le chargement prend plus de temps que prévu…"
              : "Chargement des jeux de plans…"}
          </p>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <Alert variant="danger">
          <AlertDescription>
            {isTakeoffApiError(error)
              ? error.message
              : "Impossible de charger les jeux de plans."}
          </AlertDescription>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => mutate()}>
            Réessayer
          </Button>
        </Alert>
      )}

      {/* Empty state */}
      {!isLoading && !error && sets && sets.length === 0 && (
        <EmptyState
          headingLevel={2}
          className="px-4 py-10 sm:px-6 sm:py-16"
          icon={<FolderPlusIcon aria-hidden="true" />}
          title="Aucun jeu de plans"
          description="Un jeu de plans regroupe vos fichiers PDF pour le métré. Commencez par en créer un."
          action={
            <Button
              variant="primary"
              className="h-11 w-full sm:h-9 sm:w-auto"
              onClick={() => {
                setCreateError(null);
                setModalOpen(true);
              }}
            >
              Créer mon premier jeu de plans
            </Button>
          }
        />
      )}

      {/* Set list */}
      {!isLoading && !error && sets && sets.length > 0 && (
        <div className="space-y-4">
          {sets.map((set) => (
            <PlanSetCard
              key={set.id}
              planSet={set}
              versionId={null}
              launchHref={`/dashboard/affaires/${projectId}/takeoff?launch=1&launchPlanSet=${encodeURIComponent(set.id)}`}
              launchLabel="Analyser ce jeu"
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
