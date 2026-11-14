import { materialRequestsHref } from "@/components/material-requests/format";
import { NavigationLink } from "@/components/navigation/NavigationFeedback";

/**
 * Where a supplier's documents go (TI-691): the owner dropped two quotes and an order proof among the pieces of the
 * tender, where they were classified as annexes. A quote is attached to its card in the material request, the
 * supplier's confirmation to the purchase order; the dossier keeps the pieces of the market.
 */
export function SupplierDocumentsHint({ projectId, className }: Readonly<{ projectId: string; className?: string }>) {
  return (
    <p className={className ?? "text-sm text-muted-foreground"}>
      Devis et confirmations des fournisseurs : joignez-les dans{" "}
      <NavigationLink href={materialRequestsHref(projectId)} className="font-medium text-primary underline underline-offset-2">
        Achats
      </NavigationLink>
      , le devis sur sa carte dans la demande de matériel, la confirmation sur le bon de commande. Le dossier garde les
      pièces du marché.
    </p>
  );
}
