"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatEstimateV3RatePercent, type EstimateV3TaxPropagationRequest } from "@/hooks/useEstimateV3Settings";

type TaxRatePropagationDialogProps = {
  /** Question ouverte par `requestSave` (le taux par défaut change et au moins une ligne porte un autre taux). */
  request: EstimateV3TaxPropagationRequest | null;
  /** « Oui » : vrai, le taux s'applique à toutes les lignes dans la même sauvegarde ; « Non » : faux. */
  onAnswer: (applyToLines: boolean) => void;
  /** Fermeture sans réponse (Échap) : rien n'est envoyé. */
  onCancel: () => void;
};

/**
 * Lot 2, sous-lot 2.6 (D8) - changement du taux de TVA par défaut d'une v3. Ouvert seulement quand une
 * ligne porte un autre taux ; la réponse part dans la même sauvegarde (`apply_tax_rate_to_lines`).
 */
export function TaxRatePropagationDialog({ request, onAnswer, onCancel }: Readonly<TaxRatePropagationDialogProps>) {
  const rate = request ? `${formatEstimateV3RatePercent(request.rateBp)} %` : "";
  const lines = request?.lineCount === 1 ? "1 ligne porte" : `${request?.lineCount ?? 0} lignes portent`;
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {request ? (
        <AlertDialogContent data-testid="estimate-v3-tax-propagation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Appliquer ce taux à toutes les lignes ?</AlertDialogTitle>
            <AlertDialogDescription>
              {lines} un autre taux que {rate}. « Oui » applique {rate} à toutes les lignes dans le même
              enregistrement. « Non » enregistre {rate} pour les nouvelles lignes seulement : les lignes
              existantes gardent leur taux.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onAnswer(false)}>
              Non
            </Button>
            <Button type="button" variant="primary" size="lg" onClick={() => onAnswer(true)}>
              Oui
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
