"use client";

import { useId, type ReactNode } from "react";

import { LoadingState } from "@/components/layout/loading-state";
import { fetchAffaireSupplyCost } from "@/lib/material-requests/client";
import type {
  AffaireSupplyCost as SupplyCost,
  AffaireSupplyCostAmounts,
  AffaireSupplyCostRow,
} from "@/lib/material-requests/supply-cost-contracts";
import { formatEUR } from "@/lib/money";

import { plural } from "./format";
import { LoadFailure } from "./LoadFailure";
import { useRetryableLoad } from "./useRetryableLoad";

function rowLabel(row: AffaireSupplyCostRow): string {
  if (row.kind === "unclassified") return "Non classé";
  if (row.kind === "shipping_discount") return "Port et remises";
  return row.name ?? row.code ?? "Type de fourniture";
}

function budgetSource(cost: SupplyCost): string {
  const version = cost.budget_version;
  if (!version) return "Budget en attente du devis accepté : le commandé et l’en-cours sont affichés sans budget.";
  const variant = version.variant_label ? `, variante ${version.variant_label}` : "";
  const several = version.accepted_count > 1
    ? ` ${version.accepted_count} versions sont acceptées : la plus haute fait le budget.`
    : "";
  return `Budget de la version ${version.version_number}${variant}, acceptée par le client.${several}`;
}

/** No estimate budgets shipping and discounts: their row has neither a budget nor what is left of one. */
function shownAmounts(row: AffaireSupplyCostRow): AffaireSupplyCostAmounts {
  return row.kind === "shipping_discount" ? { ...row, budget_cents: null } : row;
}

function Amount({ cents }: Readonly<{ cents: number | null }>) {
  if (cents === null) return <span className="text-muted-foreground">—</span>;
  return <>{formatEUR(cents)}</>;
}

const cell = "px-3 py-2 text-right tabular-nums";

/** Budget, ordered, pending, and what is left of the budget once both are taken out (« — » without budget). */
function AmountCells({ budget_cents, ordered_cents, pending_cents }: Readonly<AffaireSupplyCostAmounts>) {
  const left = budget_cents === null ? null : budget_cents - ordered_cents - pending_cents;
  return (
    <>
      <td className={cell}><Amount cents={budget_cents} /></td>
      <td className={cell}><Amount cents={ordered_cents} /></td>
      <td className={cell}><Amount cents={pending_cents} /></td>
      <td className={cell}>
        {left !== null && left < 0
          ? <span className="font-semibold text-danger">{`Dépassé de ${formatEUR(-left)}`}</span>
          : <Amount cents={left} />}
      </td>
    </>
  );
}

function SupplyCostTable({ cost }: Readonly<{ cost: SupplyCost }>) {
  const estimateOrders = cost.not_counted.estimate_orders;
  return (
    <>
      <p className="text-sm text-muted-foreground">{budgetSource(cost)}</p>
      {cost.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun budget ni aucune commande pour l’instant.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">Budget et commandé par type de fourniture</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs font-semibold text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Type de fourniture</th>
                <th scope="col" className="px-3 py-2 text-right">Budget</th>
                <th scope="col" className="px-3 py-2 text-right">Commandé</th>
                <th scope="col" className="px-3 py-2 text-right">En cours</th>
                <th scope="col" className="px-3 py-2 text-right">Reste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cost.rows.map((row) => (
                <tr key={`${row.kind}:${row.supply_type_id ?? ""}`}>
                  <th scope="row" className="px-3 py-2 font-medium text-foreground">{rowLabel(row)}</th>
                  <AmountCells {...shownAmounts(row)} />
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold text-foreground">
              <tr>
                <th scope="row" className="px-3 py-2">Total HT</th>
                <AmountCells {...cost.totals} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Commandé : bons confirmés ou reçus, au prix réel. En cours : brouillons et bons envoyés, au prix du devis
        retenu. Le port et les remises ne sont pas budgétés ; les frais généraux restent hors du budget de l’affaire.
        {estimateOrders > 0
          ? ` ${plural(estimateOrders, "bon créé depuis le devis n’est pas compté", "bons créés depuis le devis ne sont pas comptés")} : ils ne sont rattachés à aucune affaire.`
          : ""}
      </p>
    </>
  );
}

function Section({ children }: Readonly<{ children: ReactNode }>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h2 id={headingId} className="typo-h3 text-foreground">
        Coût des fournitures
      </h2>
      {children}
    </section>
  );
}

/**
 * The supply cost of an affaire (TI-691, delivery 4): per supply type, the budget of the version the client accepted
 * face to what its orders cost (« commandé »: confirmed or received, at their real price; « en cours »: drafts and sent
 * orders, at their retained quote's price). Without accepted version, there is no budget.
 */
export function AffaireSupplyCost({ projectId }: Readonly<{ projectId: string }>) {
  const { data: cost, error, reload } = useRetryableLoad(
    fetchAffaireSupplyCost, projectId, "Le coût des fournitures n’a pas pu être chargé.",
  );

  if (error && !cost) {
    return (
      <Section>
        <LoadFailure title="Le coût des fournitures n’a pas pu être affiché." message={error} onRetry={reload} />
      </Section>
    );
  }
  return <Section>{cost ? <SupplyCostTable cost={cost} /> : <LoadingState label="Calcul du coût des fournitures…" />}</Section>;
}
