"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import type { EstimateExplanationKind } from "@/lib/estimates/explanation-schemas";

const EstimateExplanationPanel = dynamic(
  () =>
    import("@/components/estimates/EstimateExplanationPanel").then((module) => ({
      default: module.EstimateExplanationPanel,
    })),
  {
    ssr: false,
    loading: () => null,
  }
);

type EstimateExplanationTriggerProps = {
  kind: EstimateExplanationKind;
  versionId: string;
  lineId?: string | null;
  compareVersionId?: string | null;
  lineLabel?: string | null;
  currentVersionLabel?: string | null;
  compareVersionLabel?: string | null;
  triggerLabel: string;
  surfaceLabel: string;
  variant?: "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
  cacheToken?: string | null;
};

export function EstimateExplanationTrigger({
  kind,
  versionId,
  lineId,
  compareVersionId,
  lineLabel,
  currentVersionLabel,
  compareVersionLabel,
  triggerLabel,
  surfaceLabel,
  variant = "secondary",
  size = "sm",
  className,
  cacheToken,
}: EstimateExplanationTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <EstimateExplanationPanel
        open={open}
        onOpenChange={setOpen}
        kind={kind}
        versionId={versionId}
        lineId={lineId}
        compareVersionId={compareVersionId}
        lineLabel={lineLabel}
        currentVersionLabel={currentVersionLabel}
        compareVersionLabel={compareVersionLabel}
        surfaceLabel={surfaceLabel}
        cacheToken={cacheToken}
      />
    </>
  );
}
