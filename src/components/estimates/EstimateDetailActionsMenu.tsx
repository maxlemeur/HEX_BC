"use client";

import { ChevronDownIcon } from "lucide-react";

import { DuplicateEstimateButton } from "@/components/estimates/DuplicateEstimateButton";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EstimateStatus } from "@/lib/estimates/status";

type EstimateDetailActionsMenuProps = {
  versionId: string;
  versionStatus: EstimateStatus;
  canEditVersion: boolean;
};

/**
 * Secondary actions of the read-only estimate page. A popover (not a menu) because the
 * actions open their own dialogs, which must stay mounted while they are in use.
 */
export function EstimateDetailActionsMenu({
  versionId,
  versionStatus,
  canEditVersion,
}: Readonly<EstimateDetailActionsMenuProps>) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="md"
            rightIcon={<ChevronDownIcon aria-hidden="true" />}
            data-testid="estimate-detail-more-actions"
          />
        }
      >
        Plus d&apos;actions
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Fade out behind the dialog an action opens (the popover layer sits above dialogs).
        className="w-64 gap-1 p-1.5 [body:has([data-slot=dialog-content])_&]:pointer-events-none [body:has([data-slot=dialog-content])_&]:opacity-0"
        aria-label="Autres actions sur la version"
      >
        <EstimatePdfDownloadButton versionId={versionId} versionStatus={versionStatus} />
        {canEditVersion ? <SaveAsTemplateButton versionId={versionId} /> : null}
        {canEditVersion ? <DuplicateEstimateButton versionId={versionId} /> : null}
      </PopoverContent>
    </Popover>
  );
}
