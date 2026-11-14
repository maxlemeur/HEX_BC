"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NETWORKS, NETWORK_CODES, type NetworkCode } from "@/lib/takeoff/bench/keys";
import {
  EMPTY_TARGETED_REVIEW_FILTERS,
  LOT_VALUE_PREFIX,
  TARGETED_REVIEW_FACETS,
  hasTargetedReviewFilters,
  largeAmountsSummary,
  type LargeAmounts,
  type TargetedReviewFacet,
  type TargetedReviewFilterResult,
  type TargetedReviewFilters,
  type TargetedReviewFlag,
  type TargetedReviewView,
} from "@/lib/takeoff/targeted-review-filters";
import { cn } from "@/lib/utils";

// TI-701 (D13): the targeted review's filters, above its lines. The view is one choice, as before (« À revoir »,
// « Blocages », « Règle en échec », « Incertaines »); « Gros montants », « Hypothèses » and « Non chiffré » are toggles;
// « Réseau ou lot », « Niveau ou zone » and « Plan et indice » open on the values the lines hold, checkboxes that a
// keyboard reaches and the review's shortcuts leave alone. Every choice shows its count.

const VIEWS: ReadonlyArray<[TargetedReviewView, string]> = [
  ["all", "À revoir"], ["blocked", "Blocages"], ["rule_failed", "Règle en échec"], ["uncertain", "Incertaines"],
];
const FLAGS: ReadonlyArray<[TargetedReviewFlag, string]> = [["large", "Gros montants"], ["hypotheses", "Hypothèses"], ["unpriced", "Non chiffré"]];
export const TARGETED_REVIEW_FACET_LABELS: Record<TargetedReviewFacet, string> = {
  network: "Réseau ou lot", location: "Niveau ou zone", plan: "Plan et indice",
};
const FLAG_LABELS = Object.fromEntries(FLAGS) as Record<TargetedReviewFlag, string>;

/** A value of a kind as the reviewer reads it. */
export function targetedReviewValueLabel(facet: TargetedReviewFacet, value: string, lots: ReadonlyMap<string, string>) {
  if (facet === "network") {
    if (value.startsWith(LOT_VALUE_PREFIX)) return `Lot · ${lots.get(value.slice(LOT_VALUE_PREFIX.length)) ?? "inconnu"}`;
    return (NETWORK_CODES as readonly string[]).includes(value) ? `${value} · ${NETWORKS[value as NetworkCode].label}` : value;
  }
  const [first, second] = value.split("|");
  if (facet === "location") return [first, second].filter(Boolean).join(" · ") || value;
  return second ? `${first} · indice ${second}` : first;
}

const count = (value: number) => <span className="tabular-nums text-muted-foreground">{value}</span>;

export type TargetedReviewFiltersProps = {
  filters: TargetedReviewFilters;
  result: TargetedReviewFilterResult;
  /** The toggles the job holds data for; the others are not offered. */
  available: Record<TargetedReviewFlag, boolean>;
  /** The amounts are still read: the toggles that need them wait. */
  pricingPending: boolean;
  large: LargeAmounts | null;
  /** The large lines among the lines to review. */
  largeToReview: number;
  lots: ReadonlyMap<string, string>;
  onChange: (filters: TargetedReviewFilters) => void;
};

export function TargetedReviewFilterBar({ filters, result, available, pricingPending, large, largeToReview, lots, onChange }: Readonly<TargetedReviewFiltersProps>) {
  const ignoredFlags = result.ignored.filter((kind): kind is TargetedReviewFlag => kind in FLAG_LABELS);
  const ignoredFacets = result.ignored.filter((kind): kind is TargetedReviewFacet => kind in TARGETED_REVIEW_FACET_LABELS);
  const facets = TARGETED_REVIEW_FACETS.filter((facet) => result.counts.facets[facet].length > 0);
  // A kind opens on its values when the address chose some; then the reviewer opens and closes it (unchecking its last
  // value never folds it under the pointer). A button with aria-expanded, so that the shortcuts and every browser
  // read it the same way.
  const [open, setOpen] = useState<ReadonlySet<TargetedReviewFacet>>(() => new Set(TARGETED_REVIEW_FACETS.filter((facet) => filters[facet].length > 0)));
  const toggle = (facet: TargetedReviewFacet, value: string, checked: boolean) =>
    onChange({ ...filters, [facet]: checked ? [...filters[facet], value] : filters[facet].filter((entry) => entry !== value) });
  return (
    <div role="group" aria-label="Filtrer les lignes" className="max-h-[50%] shrink-0 space-y-1.5 overflow-y-auto border-b border-border px-3 py-2">
      {/* The view (one choice) then the toggles, in one row that wraps; what they say and the reset follow at once. */}
      <div className="flex flex-wrap items-center gap-1">
        {VIEWS.map(([value, label]) => (
          <Button key={value} size="xs" variant={filters.view === value ? "secondary" : "ghost"} aria-pressed={filters.view === value}
            onClick={() => onChange({ ...filters, view: value })}>
            {label} {count(result.counts.view[value])}
          </Button>
        ))}
        {FLAGS.filter(([flag]) => available[flag]).map(([flag, label]) => (
          <Button key={flag} size="xs" variant={filters[flag] ? "secondary" : "outline"} aria-pressed={filters[flag]}
            onClick={() => onChange({ ...filters, [flag]: !filters[flag] })}>
            {label} {count(result.counts[flag])}
          </Button>
        ))}
        {hasTargetedReviewFilters(filters) ? (
          <Button size="xs" variant="link" className="px-1" onClick={() => onChange(EMPTY_TARGETED_REVIEW_FILTERS)}>
            Effacer les filtres
          </Button>
        ) : null}
      </div>
      {filters.large && available.large && large ? (
        <p role="status" className="text-xs text-foreground-secondary">{largeAmountsSummary(large, largeToReview)}</p>
      ) : null}
      {pricingPending ? <p role="status" className="text-xs text-muted-foreground">Chargement des montants du métré…</p>
        : ignoredFlags.length > 0 ? (
          <p role="status" className="text-xs text-warning">
            {`Montants indisponibles pour ce métré : ${ignoredFlags.map((flag) => `« ${FLAG_LABELS[flag]} »`).join(" et ")} ${ignoredFlags.length > 1 ? "sont ignorés" : "est ignoré"}.`}
          </p>
        ) : null}
      {ignoredFacets.length > 0 ? (
        <p role="status" className="text-xs text-warning">
          {`Aucune ligne ne porte ${ignoredFacets.map((facet) => `« ${TARGETED_REVIEW_FACET_LABELS[facet]} »`).join(" ni ")} : ${ignoredFacets.length > 1 ? "ces filtres sont ignorés" : "ce filtre est ignoré"}.`}
        </p>
      ) : null}
      {facets.map((facet) => {
        const chosen = filters[facet];
        const label = TARGETED_REVIEW_FACET_LABELS[facet];
        return (
          <div key={facet} className="rounded-md border border-border-subtle">
            <button type="button" aria-expanded={open.has(facet)} aria-controls={open.has(facet) ? `targeted-review-${facet}` : undefined}
              className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-foreground-secondary
                hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setOpen((previous) => new Set(previous.has(facet) ? [...previous].filter((entry) => entry !== facet) : [...previous, facet]))}>
              <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open.has(facet) && "rotate-90")} />
              <span className="shrink-0">{label}</span>{" "}
              {chosen.length > 0 ? (
                <span className="min-w-0 truncate font-normal text-primary">
                  {chosen.map((value) => targetedReviewValueLabel(facet, value, lots)).join(", ")}
                </span>
              ) : null}
            </button>
            {open.has(facet) ? (
              <fieldset id={`targeted-review-${facet}`} className="space-y-0.5 px-2 pb-1.5">
                <legend className="sr-only">{label}</legend>
                {result.counts.facets[facet].map(({ value, count: lines }) => {
                  const checked = chosen.includes(value);
                  return (
                    <label key={value} className={cn("flex min-h-7 cursor-pointer items-center gap-2 rounded px-1 text-xs",
                      lines === 0 && !checked ? "text-muted-foreground" : "text-foreground")}>
                      <input type="checkbox" className="size-3.5 shrink-0 accent-primary" checked={checked}
                        onChange={(event) => toggle(facet, value, event.currentTarget.checked)} />
                      <span className="min-w-0 flex-1 truncate">{targetedReviewValueLabel(facet, value, lots)}</span>{" "}
                      {count(lines)}
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
