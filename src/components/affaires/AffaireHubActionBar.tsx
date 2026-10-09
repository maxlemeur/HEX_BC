"use client";

import Link from "next/link";
import {
  GitCompareArrowsIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  PanelsTopLeftIcon,
  PencilIcon,
  PlusIcon,
  SplitIcon,
} from "lucide-react";

import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";
import type { AffaireHubSummaryResult } from "@/lib/affaires/server";
import { canLaunchNewTakeoffAnalysis } from "@/lib/takeoff/visible-status";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

const ACTION_CLASS = "max-sm:w-full max-sm:gap-1 max-sm:whitespace-nowrap max-sm:px-2 max-sm:text-xs";

export function AffaireHubActionBar({
  summary,
  versionZeroSummary,
  takeoffEnabled,
  plansSummary,
  pendingAction,
  onDuplicate,
  onCreateVariant,
  onLaunchMetre,
}: {
  summary: AffaireHubSummaryResult;
  versionZeroSummary?: VersionZeroDraftSummary | null;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
  pendingAction: "duplicate" | "variant" | null;
  onDuplicate: () => void;
  onCreateVariant: () => void;
  onLaunchMetre: () => void;
}) {
  const { currentVersion, versionsCount } = summary;
  if (!currentVersion) return null;

  const showCompare = versionsCount > 1;
  const showAnalyse =
    takeoffEnabled &&
    plansSummary &&
    plansSummary.planSetCount > 0 &&
    canLaunchNewTakeoffAnalysis(plansSummary.latestJob?.status);
  const showVersionZero =
    currentVersion.status === "draft" &&
    isEstimateAiDraftEnabled() &&
    (versionZeroSummary?.activeDraft || versionZeroSummary?.canGenerate);

  return (
    <div className="action-bar animate-fade-in stagger-1 max-sm:!grid max-sm:grid-cols-3 max-sm:gap-2 lg:flex-nowrap lg:justify-end">
      {takeoffEnabled ? (
        <Link
          href={`/dashboard/affaires/${summary.project.id}/takeoff`}
          className={buttonVariants({ variant: "primary", size: "md", className: "col-span-3 min-h-11 w-full sm:min-h-9 sm:w-auto" })}
        >
          Ouvrir les métrés
        </Link>
      ) : null}

      <Link
        href={`/dashboard/estimates/${currentVersion.id}/edit`}
        className={cn(
          buttonVariants({ variant: takeoffEnabled ? "outline" : "primary", size: "md" }),
          "min-h-11 sm:min-h-9",
          ACTION_CLASS
        )}
      >
        <PencilIcon aria-hidden="true" />
        Éditer V{currentVersion.versionNumber}
      </Link>

      {showVersionZero ? (
        <Link
          href={`/dashboard/estimates/${currentVersion.id}/edit?openVersionZero=1`}
          className={cn(buttonVariants({ variant: "outline", size: "md", className: "col-span-3 min-h-11 sm:min-h-9" }))}
        >
          {versionZeroSummary?.activeDraft ? "Revoir la V0 IA" : "Générer la V0"}
        </Link>
      ) : null}

      <Link
        href={`/dashboard/estimates/${currentVersion.id}/print`}
        className={cn(buttonVariants({ variant: "outline", size: "md", className: cn("min-h-11 sm:min-h-9", ACTION_CLASS) }))}
      >
        <DownloadIcon aria-hidden="true" />
        Exporter
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="md"
              className={cn("min-h-11 sm:min-h-9", ACTION_CLASS)}
            />
          }
        >
          <EllipsisIcon aria-hidden="true" />
          Plus
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          <DropdownMenuItem
            className="min-h-10 px-2"
            disabled={pendingAction !== null}
            onClick={onDuplicate}
          >
            <CopyIcon aria-hidden="true" />
            {pendingAction === "duplicate" ? "Duplication…" : "Nouvelle version"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-10 px-2"
            disabled={pendingAction !== null}
            onClick={onCreateVariant}
          >
            <SplitIcon aria-hidden="true" />
            {pendingAction === "variant" ? "Création de la variante…" : "Dupliquer en variante"}
          </DropdownMenuItem>
          {showCompare ? (
            <DropdownMenuItem
              className="min-h-10 px-2"
              render={<Link href={`/dashboard/estimates/${currentVersion.id}/diff`} />}
            >
              <GitCompareArrowsIcon aria-hidden="true" />
              Comparer les versions
            </DropdownMenuItem>
          ) : null}
          {showAnalyse ? (
            <DropdownMenuItem className="min-h-10 px-2" onClick={onLaunchMetre}>
              <PanelsTopLeftIcon aria-hidden="true" />
              Analyser les plans
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AffaireHubFirstVersionActionBar({ projectId }: { projectId: string }) {
  return (
    <div className="action-bar animate-fade-in stagger-1">
      <Link
        href={`/dashboard/estimates/new?projectId=${projectId}`}
        className={buttonVariants({ variant: "primary", size: "md" })}
      >
        <PlusIcon aria-hidden="true" />
        Créer un premier devis manuel
      </Link>
    </div>
  );
}
