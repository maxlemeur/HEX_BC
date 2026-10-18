"use client";

import { BookmarkPlusIcon, ChevronDownIcon, FileDownIcon } from "lucide-react";

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
  /**
   * Lot 2, sous-lot 2.6 (revue, F26-30) : brouillon au moteur 3. L'émission reste fermée jusqu'en 2.7 et les modèles
   * jusqu'en 2.8 (décisions du porteur) : le PDF et « Sauvegarder comme modèle » sont désactivés et la fiche dit
   * pourquoi, au lieu de laisser le serveur refuser par le message générique du moteur 3.
   */
  closedEngineV3Actions?: boolean;
};

const ENGINE_V3_ACTIONS_REASON_ID = "estimate-detail-engine-v3-actions-reason";
export const ESTIMATE_V3_DETAIL_ACTIONS_REASON =
  "Moteur de calcul 3 : le PDF et l’enregistrement comme modèle ne sont pas encore disponibles pour ce brouillon.";

/**
 * Secondary actions of the read-only estimate page. A popover (not a menu) because the
 * actions open their own dialogs, which must stay mounted while they are in use.
 */
export function EstimateDetailActionsMenu({
  versionId,
  versionStatus,
  canEditVersion,
  closedEngineV3Actions = false,
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
        {closedEngineV3Actions ? (
          <>
            <Button className="w-full justify-start" variant="ghost" size="md" type="button" disabled
              leftIcon={<FileDownIcon aria-hidden="true" />} aria-describedby={ENGINE_V3_ACTIONS_REASON_ID}>
              Préparer le PDF
            </Button>
            {canEditVersion ? (
              <Button className="w-full justify-start" variant="ghost" size="md" type="button" disabled
                leftIcon={<BookmarkPlusIcon aria-hidden="true" />} aria-describedby={ENGINE_V3_ACTIONS_REASON_ID}>
                Sauvegarder comme modèle
              </Button>
            ) : null}
            <p id={ENGINE_V3_ACTIONS_REASON_ID} className="px-2.5 py-1.5 text-xs text-muted-foreground">
              {ESTIMATE_V3_DETAIL_ACTIONS_REASON}
            </p>
          </>
        ) : (
          <>
            <EstimatePdfDownloadButton versionId={versionId} versionStatus={versionStatus} />
            {canEditVersion ? <SaveAsTemplateButton versionId={versionId} /> : null}
          </>
        )}
        {canEditVersion ? <DuplicateEstimateButton versionId={versionId} /> : null}
      </PopoverContent>
    </Popover>
  );
}
