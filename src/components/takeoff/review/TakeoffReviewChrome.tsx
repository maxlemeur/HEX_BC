"use client";

import Link from "next/link";
import { CircleCheckIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Loading / error states of the review page
// ---------------------------------------------------------------------------

export function TakeoffReviewLoadingState({ title }: { title: string }) {
  return (
    <div className="animate-fade-in">
      <PageHeader title={title} description="Chargement de l’extraction…" />
      <Card className="p-6" role="status" aria-label="Chargement de la revue">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-4"
              style={{ width: `${60 + (i % 3) * 15}%` }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

export function TakeoffReviewErrorState({
  title,
  message,
  backHref,
  backLabel,
}: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={title}
        description={<span role="alert">{message}</span>}
        actions={
          <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
            {backLabel}
          </Link>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apply success banner (affaire context)
// ---------------------------------------------------------------------------

export function TakeoffApplySuccessBanner({
  sourceFileName,
  targetSectionLabel,
  strategy,
  createdCount,
  updatedCount,
  ignoredCount,
  estimateHref,
  activityHref,
}: {
  sourceFileName: string | null;
  targetSectionLabel: string;
  strategy: string;
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
  estimateHref: string;
  activityHref: string;
}) {
  return (
    <section
      aria-labelledby="takeoff-apply-success-title"
      className="rounded-2xl border border-success-border bg-success-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-success">
            Apply contrôlé confirmé
          </p>
          <h2
            id="takeoff-apply-success-title"
            className="mt-1 text-lg font-semibold text-foreground"
          >
            Le devis a été enrichi depuis le métré source
          </h2>
          <p className="mt-2 break-words text-sm text-foreground-secondary">
            Source : {sourceFileName ?? "métré"} · Section : {targetSectionLabel}
          </p>
          <p className="mt-1 text-sm text-foreground-secondary">
            Stratégie : {strategy} · créés {createdCount} · mis à jour {updatedCount} ·
            ignorés {ignoredCount}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={estimateHref} className={buttonVariants({ variant: "primary" })}>
            Ouvrir le chiffrage
          </Link>
          <Link href={activityHref} className={buttonVariants({ variant: "outline" })}>
            Centre d&apos;activité métrés
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Apply readiness bar (production mode)
// ---------------------------------------------------------------------------

export function TakeoffApplyReadinessBar({
  isApplyReady,
  includedCount,
  readinessMessage,
  onOpenApplyWizard,
}: {
  isApplyReady: boolean;
  includedCount: number;
  readinessMessage: string;
  onOpenApplyWizard: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p id="takeoff-apply-readiness" className="text-sm" role="status">
        {isApplyReady ? (
          <span className="flex items-center gap-2 text-success">
            <CircleCheckIcon aria-hidden="true" className="size-4" />
            Prêt à appliquer ({includedCount} items)
          </span>
        ) : (
          <span className="text-muted-foreground">{readinessMessage}</span>
        )}
      </p>
      <Button
        variant="primary"
        className="w-full sm:w-auto"
        disabled={!isApplyReady}
        aria-describedby="takeoff-apply-readiness"
        onClick={onOpenApplyWizard}
      >
        Appliquer au chiffrage
      </Button>
    </div>
  );
}
