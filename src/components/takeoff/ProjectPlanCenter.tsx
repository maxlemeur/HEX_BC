"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import useSWR from "swr";
import { ArrowRight } from "lucide-react";

import {
  createPlanSetAction,
  deletePlanSetAction,
} from "@/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets";
import {
  JourneyFacts,
  JourneyNext,
  JourneyPanel,
  JourneyTextLink,
} from "@/components/journey/JourneyPage";
import { formatFileSize } from "@/components/takeoff/PlanFileCard";
import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
import { PlanDossierSyncNotice } from "@/components/takeoff/PlanDossierSyncNotice";
import { PlanSetFormModal } from "@/components/takeoff/PlanSetFormModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDelayedLoadingIndicator } from "@/hooks/useDelayedLoadingIndicator";
import {
  fetchPlanSetsForProject,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type { CreatePlanSetInput, PlanSetListItem } from "@/lib/takeoff/types";

type ProjectPlanCenterProps = {
  projectId: string;
  initialPlanSets?: PlanSetListItem[];
  /** The affaire already has an analysis: the plans lead to the métrés rather than to a new one. */
  hasTakeoffAnalysis?: boolean;
};

function SkeletonRow() {
  return (
    <div className="px-4 py-4 sm:px-6" aria-hidden="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-5 w-48 max-w-[60%]" />
        <Skeleton className="ml-auto h-4 w-24" />
      </div>
      <Skeleton className="mt-3 h-4 w-32" />
    </div>
  );
}

export function ProjectPlanCenter({ projectId, initialPlanSets, hasTakeoffAnalysis = false }: ProjectPlanCenterProps) {
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

  const openCreateModal = () => {
    setCreateError(null);
    setModalOpen(true);
  };
  const takeoffHref = `/dashboard/affaires/${projectId}/takeoff`;
  const launchHref = (setId: string) =>
    `${takeoffHref}?launch=1&launchPlanSet=${encodeURIComponent(setId)}`;

  const loaded = !isLoading && !error && sets ? sets : null;
  const totalFiles = loaded ? loaded.reduce((acc, s) => acc + s.file_count, 0) : 0;
  const totalSizeBytes = loaded ? loaded.reduce((acc, s) => acc + s.total_size_bytes, 0) : 0;
  // The métré starts from the first set that holds plans; the other sets keep their own link.
  const readySet = loaded?.find((set) => set.file_count > 0);
  // As on the hub, a first analysis is launched once; afterwards the métrés page leads.
  const leadsToTakeoff = Boolean(readySet) && hasTakeoffAnalysis;
  const factValue = (value: ReactNode) => (error ? "Indisponible" : loaded ? value : "…");

  return (
    <>
      {unsynchronizedProjectId && <PlanDossierSyncNotice projectId={unsynchronizedProjectId} onSynchronized={() => { setUnsynchronizedProjectId(null); void mutate(); }} />}

      <div className="journey-grid">
        <JourneyPanel
          headingId="plan-sets-heading"
          title="Jeux de plans"
          actions={
            loaded?.length ? (
              <Button variant="outline" size="sm" onClick={openCreateModal}>
                Créer un jeu de plans
              </Button>
            ) : undefined
          }
        >
          {isLoading ? (
            <div role="status" aria-live="polite">
              <p className="px-4 pt-5 text-sm text-muted-foreground sm:px-6">
                {isSlowLoading
                  ? "Le chargement prend plus de temps que prévu…"
                  : "Chargement des jeux de plans…"}
              </p>
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : error ? (
            <div className="journey-panel-body">
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
            </div>
          ) : loaded && loaded.length === 0 ? (
            <JourneyNext
              title="Aucun jeu de plans"
              description="Un jeu de plans regroupe vos fichiers PDF pour le métré. Commencez par en créer un."
              action={
                <Button variant="primary" onClick={openCreateModal}>
                  Créer mon premier jeu de plans
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              }
            />
          ) : loaded ? (
            <>
              {readySet && leadsToTakeoff ? (
                <JourneyNext
                  title="Suivre le métré"
                  description="Une analyse existe déjà pour cette affaire : suivez-la et vérifiez ses quantités dans les métrés. Pour analyser un autre jeu, ouvrez-le ci-dessous."
                  action={
                    <Link href={takeoffHref} className={buttonVariants({ variant: "primary" })}>
                      Ouvrir les métrés
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  }
                />
              ) : readySet ? (
                <JourneyNext
                  title="Analyser les plans"
                  description={`L’IA lit ${readySet.file_count === 1 ? "le plan" : `les ${readySet.file_count} plans`} de « ${readySet.name} » et propose les quantités. Vous les vérifiez avant de les reporter au devis.`}
                  action={
                    <Link href={launchHref(readySet.id)} className={buttonVariants({ variant: "primary" })}>
                      Préparer le métré
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  }
                />
              ) : (
                <JourneyNext
                  title="Ajouter les plans PDF"
                  description="Ouvrez un jeu ci-dessous et glissez-y vos PDF : l’IA s’en servira pour préparer le métré."
                />
              )}
              <div className="journey-list">
                {loaded.map((set) => (
                  <PlanSetCard
                    key={set.id}
                    appearance="row"
                    planSet={set}
                    versionId={null}
                    launchHref={launchHref(set.id)}
                    launchLabel="Analyser ce jeu"
                    deletePlanSetHandler={deletePlanSetAction}
                    onDeleted={handleSetDeleted}
                    onFilesChanged={handleFilesChanged}
                    onUpdated={handleSetUpdated}
                  />
                ))}
              </div>
            </>
          ) : null}
        </JourneyPanel>

        <JourneyFacts
          label="Repères des plans"
          facts={[
            { label: "Jeux de plans", value: factValue(loaded?.length) },
            { label: "Plans PDF", value: factValue(totalFiles) },
            ...(totalSizeBytes > 0 ? [{ label: "Taille totale", value: formatFileSize(totalSizeBytes) }] : []),
          ]}
        >
          {leadsToTakeoff ? null : (
            <div className="journey-facts-actions">
              <JourneyTextLink href={takeoffHref}>Suivre les métrés</JourneyTextLink>
            </div>
          )}
        </JourneyFacts>
      </div>

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
    </>
  );
}
