import { Button } from "@/components/ui/button";
import type { ItemQuantityChoice, ItemQuantityOptions } from "@/lib/takeoff/item-table";
import { formatItemQuantity } from "@/lib/takeoff/item-table-labels";

export function ItemQuantityChoiceButtons({ options, disabled, onChoose }: {
  options: ItemQuantityOptions; disabled?: boolean; onChoose: (choice: ItemQuantityChoice) => void;
}) {
  const choose = (source: ItemQuantityChoice["source"]) => onChoose({ source, verified_quantity: options.verifiedQuantity,
    alternative_quantity: options.alternativeQuantity });
  return (
    <div role="group" aria-label="Quantité retenue pour ce poste sur ce plan" className="space-y-1.5">
      <p className="text-sm">{options.verifiedQuantity === null
        ? "Le comptage reste à vérifier. Vous pouvez retenir la saisie de ce plan pour le devis."
        : "La quantité retenue sera envoyée au devis pour ce poste sur ce plan."}</p>
      <div className="flex flex-wrap gap-2">
        {options.alternativeQuantity !== null ? (
          <Button variant="outline" size="sm" disabled={disabled || !options.allowAlternative} onClick={() => choose(options.alternativeSource)}>
            {options.alternativeSource === "entered" ? "Conserver la saisie du plan" : "Conserver la mesure"} ({formatItemQuantity(options.alternativeQuantity, options.alternativeUnit)})
          </Button>
        ) : null}
        {options.verifiedQuantity !== null ? <Button variant="outline" size="sm" disabled={disabled || !options.allowCount} onClick={() => choose("verified_count")}>
          Retenir le comptage vérifié ({formatItemQuantity(options.verifiedQuantity, options.unit)})
        </Button> : null}
      </div>
    </div>
  );
}
