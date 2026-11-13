"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

import type { Resolution } from "./page-decisions";

// TI-723: at the application's confirmation, each line « Fusionner » sends onto a DPGF line outside the reconciliation,
// which the database refuses whatever the page decisions. Both lines are named, with the way out: the reconciliation,
// where the line is linked to the DPGF line (it then feeds it through its composition), opened from here when the host
// knows where it is. Nothing confirms until then (the resolution is not complete).

export const DPGF_MERGE_TITLE = "Fusion sur une ligne DPGF";
const OPEN_RECONCILIATION = "Ouvrir le rapprochement DPGF";

export function TakeoffDpgfMergePanel({ resolution, dpgfReviewHref, onOpenDpgfReview }: Readonly<{
  resolution: Pick<Resolution, "merges"> | null;
  /** The reconciliation of this takeoff, when the host has its address. */
  dpgfReviewHref?: string;
  /** Called when the estimator opens the reconciliation (the host closes the wizard, or opens it itself without an address). */
  onOpenDpgfReview?: () => void;
}>) {
  if (!resolution || resolution.merges.length === 0) return null;
  const linkable = resolution.merges.some((advice) => advice.elsewhere.includes("link_in_dpgf_review"));
  return (
    <section aria-label={DPGF_MERGE_TITLE} className="space-y-2 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 space-y-2 text-sm">
          <h2 className="font-semibold text-foreground">{DPGF_MERGE_TITLE}</h2>
          {/* Two lines of one designation and quantity sent onto two DPGF lines of one title read the same: keyed by place. */}
          {resolution.merges.map((advice, index) => (
            <div key={index} className="space-y-1">
              <p role="status" className="text-foreground">{advice.text}</p>
              {advice.exits.map((exit) => <p key={exit} className="text-foreground-secondary">{exit}</p>)}
            </div>
          ))}
          {linkable && dpgfReviewHref ? (
            <Link href={dpgfReviewHref} onClick={onOpenDpgfReview} className={buttonVariants({ variant: "outline", size: "xs" })}>
              {OPEN_RECONCILIATION}
            </Link>
          ) : linkable && onOpenDpgfReview ? (
            <Button type="button" variant="outline" size="xs" onClick={onOpenDpgfReview}>{OPEN_RECONCILIATION}</Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
