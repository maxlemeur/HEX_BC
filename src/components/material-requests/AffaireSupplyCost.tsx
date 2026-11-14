"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { fetchAffaireSupplyCost } from "@/lib/material-requests/client";
import type {
  AffaireSupplyCost as SupplyCost,
  AffaireSupplyCostAmounts,
  AffaireSupplyCostRow,
} from "@/lib/material-requests/supply-cost-contracts";
import { formatEUR } from "@/lib/money";

import { plural, SUPPLY_COST_ANCHOR } from "./format";
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
function AmountCells(amounts: Readonly<AffaireSupplyCostAmounts>) {
  const { budget_cents, ordered_cents, pending_cents } = amounts;
  const left = leftOf(amounts);
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

/** What is left of a budget once the ordered and the pending are taken out; null without budget. */
function leftOf({ budget_cents, ordered_cents, pending_cents }: AffaireSupplyCostAmounts): number | null {
  return budget_cents === null ? null : budget_cents - ordered_cents - pending_cents;
}

/**
 * The four figures of the affaire, read before anything else on the purchasing page (TI-691: the owner looked for
 * the supply cost under the list of requests and asked where it was).
 */
function Totals({ totals }: Readonly<{ totals: AffaireSupplyCostAmounts }>) {
  const left = leftOf(totals);
  const figures: Array<{ name: string; value: ReactNode; over?: boolean }> = [
    { name: "Budget", value: <Amount cents={totals.budget_cents} /> },
    { name: "Commandé", value: <Amount cents={totals.ordered_cents} /> },
    { name: "En cours", value: <Amount cents={totals.pending_cents} /> },
    left !== null && left < 0
      ? { name: "Reste", value: `Dépassé de ${formatEUR(-left)}`, over: true }
      : { name: "Reste", value: <Amount cents={left} /> },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {figures.map((figure) => (
        <div key={figure.name} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{`${figure.name} HT`}</dt>
          <dd className={`mt-0.5 break-words font-display text-xl font-semibold tabular-nums ${figure.over ? "text-danger" : "text-foreground"}`}>
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SupplyCostTable({ cost }: Readonly<{ cost: SupplyCost }>) {
  return (
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
  );
}

function Section({ action, children }: Readonly<{ action?: ReactNode; children: ReactNode }>) {
  const headingId = useId();
  return (
    <section
      id={SUPPLY_COST_ANCHOR}
      aria-labelledby={headingId}
      className="min-w-0 scroll-mt-4 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="typo-h3 text-foreground">
          Coût des fournitures
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SupplyCostBody({ cost }: Readonly<{ cost: SupplyCost }>) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const estimateOrders = cost.not_counted.estimate_orders;
  const hasRows = cost.rows.length > 0;
  return (
    <Section
      action={
        hasRows ? (
          <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((current) => !current)}>
            <ChevronDown aria-hidden="true" className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            Détail par type de fourniture
          </Button>
        ) : null
      }
    >
      {hasRows ? (
        <Totals totals={cost.totals} />
      ) : (
        <p className="text-sm text-foreground">Aucun budget ni aucune commande pour l’instant.</p>
      )}
      <p className="text-sm text-muted-foreground">{budgetSource(cost)}</p>
      {hasRows ? (
        <div id={detailId} hidden={!open}>
          <SupplyCostTable cost={cost} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Commandé : bons confirmés ou reçus, au prix réel. En cours : brouillons et bons envoyés, au prix du devis
        retenu. Le port et les remises ne sont pas budgétés ; les frais généraux restent hors du budget de l’affaire.
        {estimateOrders > 0
          ? ` ${plural(estimateOrders, "bon créé depuis le devis n’est pas compté", "bons créés depuis le devis ne sont pas comptés")} : ils ne sont rattachés à aucune affaire.`
          : ""}
      </p>
    </Section>
  );
}

/**
 * The supply cost of an affaire (TI-691, delivery 4): per supply type, the budget of the version the client accepted
 * face to what its orders cost (« commandé »: confirmed or received, at their real price; « en cours »: drafts and sent
 * orders, at their retained quote's price). Without accepted version, there is no budget. The totals lead the
 * purchasing page; the table per supply type opens under them.
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
  if (!cost) {
    return (
      <Section>
        <LoadingState label="Calcul du coût des fournitures…" />
      </Section>
    );
  }
  return <SupplyCostBody cost={cost} />;
}
