"use client";

import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { CostingWorkbookArticle } from "@/lib/catalogue/costing-workbook";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import {
  COSTING_WORKBOOK_SUGGESTION_LIMITS,
  type CostingWorkbookSuggestionsResponseOf,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { catalogueErrorMessage } from "@/lib/catalogue/supplier-items-client";
import { foldText } from "@/lib/text/fold";

import { confidenceLabel, RETAINED_CONFIDENCE, SuggestButton, SuggestionStatus, useWorkbookAssistant } from "./assistant";
import { formatCount, plural, useWorkbookEditor } from "./shared";

/**
 * The drafts the reader could not classify (« divers » by default) or whose family has no supply type in the
 * company (TI-711), by type of article: one choice gives its supply type to every draft of a type. A proposal
 * comes from the validated articles of the same type in the catalogue, else from the AI source chosen; the
 * office retains it or chooses another.
 */

type SupplyType = { id: string; code: string; name: string };
type Suggestion = NonNullable<CostingWorkbookSuggestionsResponseOf<"supply_types">["items"][number]["suggestion"]>;
type Group = { key: string; productType: string; familyCode: string | null; material: string | null; samples: string[]; rows: number[] };

export function SupplyTypeGroups({ articles, companyTypes, chosenRows, onChoose }: Readonly<{
  /** The proposed drafts to classify: without supply type, or classified by default. */
  articles: ReadonlyArray<{ row: number; article: CostingWorkbookArticle }>;
  companyTypes: readonly SupplyType[];
  chosenRows: Readonly<Record<number, string>>;
  onChoose: (choices: ReadonlyArray<{ rows: readonly number[]; supplyTypeId: string | null }>) => void;
}>) {
  const selectId = useId();
  const { busy } = useWorkbookEditor();
  const { requestOptions } = useWorkbookAssistant();
  const [suggestions, setSuggestions] = useState<ReadonlyMap<string, Suggestion>>(new Map());
  const [outcome, setOutcome] = useState<{ status: CostingWorkbookSuggestionsResponseOf<"supply_types">["status"]; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byKey = new Map<string, Group>();
    for (const { row, article } of articles) {
      const productType = article.product_type ?? article.designation;
      const key = `${article.family_code ?? ""}|${foldText(productType)}`;
      const group = byKey.get(key);
      if (group) {
        group.rows.push(row);
        if (group.samples.length < COSTING_WORKBOOK_SUGGESTION_LIMITS.samples) group.samples.push(article.designation.slice(0, 255));
      } else {
        byKey.set(key, {
          key, productType, familyCode: article.family_code, material: article.material,
          samples: [article.designation.slice(0, 255)], rows: [row],
        });
      }
    }
    return [...byKey.values()].sort((left, right) => right.rows.length - left.rows.length || left.productType.localeCompare(right.productType, "fr"));
  }, [articles]);
  const typeById = new Map(companyTypes.map((type) => [type.id, type]));
  const chosenOf = (group: Group) => {
    const ids = new Set(group.rows.map((row) => chosenRows[row] ?? ""));
    return ids.size === 1 ? [...ids][0] : "";
  };
  const retainable = groups.flatMap((group) => {
    const suggestion = suggestions.get(group.key);
    const sure = suggestion?.supply_type_id
      && (suggestion.source === "catalogue" || (suggestion.confidence ?? 0) >= RETAINED_CONFIDENCE)
      && chosenOf(group) !== suggestion.supply_type_id;
    return sure ? [{ rows: group.rows, supplyTypeId: suggestion.supply_type_id }] : [];
  });

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      // The request names each group by its position: a key of the screen may be longer than the contract allows.
      const asked = groups.slice(0, COSTING_WORKBOOK_SUGGESTION_LIMITS.supplyTypeGroups);
      const answer = await requestWorkbookSuggestions({
        task: "supply_types",
        ...requestOptions,
        groups: asked.map((group, index) => ({
          key: String(index),
          family_code: group.familyCode?.slice(0, 80) ?? null,
          product_type: group.productType.slice(0, 255),
          material: group.material?.slice(0, 255) ?? null,
          samples: group.samples,
          count: group.rows.length,
        })),
      });
      const next = new Map<string, Suggestion>();
      for (const item of answer.items) {
        const group = asked[Number(item.key)];
        if (group && item.suggestion) next.set(group.key, item.suggestion);
      }
      setSuggestions(next);
      setOutcome({ status: answer.status, message: answer.message });
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Les propositions de types n’ont pas pu être demandées."));
    } finally {
      setLoading(false);
    }
  }

  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="costing-workbook-classify-title" className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1">
        <h4 id="costing-workbook-classify-title" className="text-sm font-semibold">
          {`${formatCount(articles.length)} ${plural(articles.length, "brouillon", "brouillons")} à classer, en ${formatCount(groups.length)} ${plural(groups.length, "type d’article", "types d’article")}`}
        </h4>
        <p className="text-xs text-muted-foreground">
          Le classeur ne dit pas de quelle fourniture il s’agit, ou l’entreprise n’a pas de type pour sa famille. Un choix vaut pour tous les brouillons du type.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SuggestButton label="Proposer des types" withAi loading={loading} disabled={busy || companyTypes.length === 0} onClick={() => void suggest()} />
        {retainable.length > 0 ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onChoose(retainable)}>
            {`Retenir ${formatCount(retainable.length)} ${plural(retainable.length, "proposition", "propositions")}`}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
      {outcome ? <SuggestionStatus status={outcome.status} message={outcome.message} /> : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table aria-label="Brouillons à classer par type d’article" className="w-full min-w-160 text-left text-sm">
          <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2.5">
              <th scope="col">Type d’article</th>
              <th scope="col" className="text-right">Brouillons</th>
              <th scope="col">Type de fourniture</th>
              <th scope="col">Proposition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map((group, index) => {
              const suggestion = suggestions.get(group.key);
              const suggested = suggestion?.supply_type_id ? typeById.get(suggestion.supply_type_id) : undefined;
              const chosen = chosenOf(group);
              const id = `${selectId}-${index}`;
              return (
                <tr key={group.key} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2">
                  <td>
                    <label htmlFor={id} className="font-medium">{group.productType}</label>
                    <p className="text-xs text-muted-foreground">
                      {[group.familyCode ? `famille ${group.familyCode}` : "", group.samples[0] !== group.productType ? group.samples[0] : ""].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="text-right tabular-nums">{formatCount(group.rows.length)}</td>
                  <td>
                    <NativeSelect
                      id={id}
                      size="sm"
                      wrapperClassName="max-w-60"
                      value={chosen}
                      disabled={busy || companyTypes.length === 0}
                      onChange={(event) => onChoose([{ rows: group.rows, supplyTypeId: event.currentTarget.value || null }])}
                    >
                      <option value="">Celui de sa famille</option>
                      {companyTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="text-xs">
                    {suggestion && suggested ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>
                          {suggestion.source === "catalogue"
                            ? `${suggested.name}, comme les articles validés de ce type`
                            : `${suggested.name} (IA, ${confidenceLabel(suggestion.confidence)})`}
                        </span>
                        {chosen !== suggested.id ? (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            aria-label={`Retenir ${suggested.name} pour ${group.productType}`}
                            onClick={() => onChoose([{ rows: group.rows, supplyTypeId: suggested.id }])}
                          >
                            Retenir
                          </Button>
                        ) : null}
                      </span>
                    ) : suggestion ? (
                      <span className="text-muted-foreground">Aucun type ne convient selon l’IA.</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
