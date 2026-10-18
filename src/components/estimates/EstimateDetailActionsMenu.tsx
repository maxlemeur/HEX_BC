"use client";

import { BookmarkPlusIcon, ChevronDownIcon } from "lucide-react";

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
   * Lot 2 : devis au moteur 3. Les modèles restent fermés jusqu'en 2.8 (décision du porteur) : « Sauvegarder comme
   * modèle » est désactivé et la fiche dit pourquoi, au lieu de laisser le serveur refuser par le message générique du
   * moteur 3 (2.6, F26-30). Le PDF, fermé par 2.6 jusqu'à l'émission v3, est ouvert depuis 2.7 (contrat client 2).
   */
  closedEngineV3Template?: boolean;
};

const ENGINE_V3_TEMPLATE_REASON_ID = "estimate-detail-engine-v3-template-reason";
export const ESTIMATE_V3_DETAIL_TEMPLATE_REASON =
  "Moteur de calcul 3 : l’enregistrement comme modèle n’est pas encore disponible pour ce devis.";

/**
 * Secondary actions of the read-only estimate page. A popover (not a menu) because the
 * actions open their own dialogs, which must stay mounted while they are in use.
 */
export function EstimateDetailActionsMenu({
  versionId,
  versionStatus,
  canEditVersion,
  closedEngineV3Template = false,
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
        {canEditVersion && closedEngineV3Template ? (
          <>
            <Button className="w-full justify-start" variant="ghost" size="md" type="button" disabled
              leftIcon={<BookmarkPlusIcon aria-hidden="true" />} aria-describedby={ENGINE_V3_TEMPLATE_REASON_ID}>
              Sauvegarder comme modèle
            </Button>
            <p id={ENGINE_V3_TEMPLATE_REASON_ID} className="px-2.5 py-1.5 text-xs text-muted-foreground">
              {ESTIMATE_V3_DETAIL_TEMPLATE_REASON}
            </p>
          </>
        ) : canEditVersion ? (
          <SaveAsTemplateButton versionId={versionId} />
        ) : null}
        {canEditVersion ? <DuplicateEstimateButton versionId={versionId} /> : null}
      </PopoverContent>
    </Popover>
  );
}
