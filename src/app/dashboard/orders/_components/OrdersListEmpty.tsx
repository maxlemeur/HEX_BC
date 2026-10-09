import Link from "next/link";
import { SearchIcon, ShoppingCartIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { buttonVariants } from "@/components/ui/button";

type OrdersListEmptyProps = {
  isLoading: boolean;
  /** False when the organisation has no order at all, true when only the filters hide them. */
  hasOrders: boolean;
};

/** Loading, first-use and no-result states shared by the card list and the table. */
export function OrdersListEmpty({ isLoading, hasOrders }: OrdersListEmptyProps) {
  if (isLoading) {
    return <LoadingState label="Chargement des bons de commande…" className="min-h-40" />;
  }

  if (!hasOrders) {
    return (
      <EmptyState
        variant="plain"
        icon={<ShoppingCartIcon aria-hidden="true" />}
        title="Aucun bon de commande"
        description="Les bons de commande sont générés depuis un chiffrage accepté."
        action={
          <Link href="/dashboard/affaires" className={buttonVariants({ variant: "outline", size: "md" })}>
            Voir les affaires
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      variant="plain"
      icon={<SearchIcon aria-hidden="true" />}
      title="Aucun résultat"
      description="Modifiez vos filtres pour voir plus de résultats."
    />
  );
}
