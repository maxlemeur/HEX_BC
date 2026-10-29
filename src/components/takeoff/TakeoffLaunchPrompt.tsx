"use client";

import Link from "next/link";
import { useState } from "react";
import { FileTextIcon } from "lucide-react";

import { LaunchMetreDialog } from "@/components/affaires/LaunchMetreDialog";
import { buttonVariants } from "@/components/ui/button";
import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";

const RECENT_PROMPT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function shouldShowTakeoffPrompt(input: {
  takeoffEnabled: boolean;
  planFileCount: number;
  defaultPlanSetId: string | null;
  defaultPlanSetUpdatedAt: string | null;
  latestJob:
    | {
        status: string;
        planSetId: string | null;
        estimateVersionId?: string | null;
        createdAt: string;
      }
    | null;
  targetVersionId: string | null;
  hasLaunchableVersionTarget: boolean;
  permanentlyDismissed: boolean;
  temporarilyDismissed: boolean;
}): boolean {
  if (!input.takeoffEnabled) return false;
  if (input.planFileCount === 0) return false;
  if (!input.defaultPlanSetId) return false;
  if (!input.hasLaunchableVersionTarget) return false;
  if (input.permanentlyDismissed) return false;
  if (input.temporarilyDismissed) return false;
  if (!input.latestJob) return true;
  if (input.latestJob.planSetId !== input.defaultPlanSetId) return true;
  if (
    input.latestJob.status === "action_required" ||
    input.latestJob.status === "failed" ||
    input.latestJob.status === "canceled"
  ) {
    return true;
  }

  const createdAt = new Date(input.latestJob.createdAt);
  if (Number.isNaN(createdAt.getTime())) return true;

  const planSetWasUpdatedAfterJob =
    typeof input.defaultPlanSetUpdatedAt === "string" &&
    input.defaultPlanSetUpdatedAt.localeCompare(input.latestJob.createdAt) > 0;
  if (planSetWasUpdatedAfterJob) {
    return true;
  }

  if (
    input.targetVersionId &&
    input.latestJob.estimateVersionId &&
    input.latestJob.estimateVersionId !== input.targetVersionId
  ) {
    return true;
  }

  const ageMs = Date.now() - createdAt.getTime();
  return ageMs > RECENT_PROMPT_WINDOW_MS;
}

type TakeoffLaunchPromptProps = {
  projectId: string;
  versionId?: string | null;
  versionLabel?: string;
  sourceVersionId?: string | null;
  sourceVersionLabel?: string;
  planSetId: string;
  planSetName?: string | null;
  planFileCount: number;
  launchRecommendation: TakeoffDocumentRecommendation;
  onLaunched?: (jobId: string, versionId: string) => void;
  onDismissTemporary?: () => void;
  onDismissPermanent?: () => void;
  compact?: boolean;
  resultsHref?: string;
  title?: string;
};

export function TakeoffLaunchPrompt({
  projectId, versionId, sourceVersionId, planSetId, planSetName, planFileCount,
  launchRecommendation, onLaunched, onDismissTemporary, onDismissPermanent,
  compact, resultsHref, title, versionLabel, sourceVersionLabel,
}: TakeoffLaunchPromptProps) {
  const [open, setOpen] = useState(false);
  const [launched, setLaunched] = useState(false);
  const targetId = versionId ?? sourceVersionId ?? null;
  const targetNumber = Number((versionId ? versionLabel : sourceVersionLabel)?.match(/V(\d+)/i)?.[1] ?? 0);
  return <>
    <div role="region" aria-label="Préparation du métré" className={`rounded-lg border border-primary/20 bg-primary/5 ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
      <div className="flex items-center gap-2"><FileTextIcon className="size-4 text-primary" aria-hidden="true" /><h2 className="text-sm font-semibold">{launched ? "Demande d’analyse créée" : title ?? "Préparer le métré"}</h2></div>
      <p className="mt-2 text-xs text-muted-foreground">{planSetName ?? "Plans de l'affaire"} · {planFileCount} fichier{planFileCount > 1 ? "s" : ""}. {launched ? "Suivez le traitement puis vérifiez les résultats." : "Confirmez les pièces, le périmètre et les conventions avant de lancer une analyse."}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {launched ? <Link href={resultsHref ?? `/dashboard/affaires/${projectId}/takeoff`} className={buttonVariants({ variant: "outline", size: "sm" })}>Suivre l&apos;avancement</Link> : <button type="button" className={buttonVariants({ variant: "primary", size: "sm" })} disabled={!targetId} onClick={() => setOpen(true)}>Préparer le métré</button>}
        {onDismissTemporary && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={onDismissTemporary}>Me rappeler plus tard</button>}
        {onDismissPermanent && <button type="button" className="text-xs text-muted-foreground underline" onClick={onDismissPermanent}>Ne plus proposer pour cette affaire</button>}
      </div>
    </div>
    <LaunchMetreDialog open={open} onOpenChange={setOpen} projectId={projectId}
      currentVersion={targetId ? { id: targetId, status: versionId ? "draft" : "sent", versionNumber: targetNumber } : null}
      availableVersions={targetId ? [{ id: targetId, versionNumber: targetNumber }] : []}
      availablePlanSets={[{ id: planSetId, name: planSetName ?? "Plans de l'affaire", fileCount: planFileCount }]}
      initialPlanSetId={planSetId}
      plansContext={{ defaultPlanSetId: planSetId, defaultPlanSetName: planSetName, defaultPlanSetFileCount: planFileCount, launchRecommendation }}
      onLaunched={(jobId, targetVersionId) => { setLaunched(true); onLaunched?.(jobId, targetVersionId); }}
    />
  </>;
}
