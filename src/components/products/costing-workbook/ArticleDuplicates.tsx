"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsdCeiling, MODEL_TEST_CEILING_NANO_USD } from "@/lib/ai/access/openai-pricing";
import type { CostingWorkbookArticle } from "@/lib/catalogue/costing-workbook";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import {
  COSTING_WORKBOOK_SUGGESTION_LIMITS,
  type CostingWorkbookSuggestionsResponseOf,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import { catalogueErrorMessage } from "@/lib/catalogue/supplier-items-client";

import { confidenceLabel, RETAINED_CONFIDENCE, SuggestButton, SuggestionStatus, useWorkbookAssistant } from "./assistant";
import { boundedPage, DECISIONS_PER_PAGE, formatCount, plural, ReviewPager, useWorkbookEditor } from "./shared";

/**
 * Drafts the catalogue may already hold under another reference (TI-711). The import compares references only:
 * an article entered by hand earlier, under its own reference, would be created a second time. The search is
 * asked for, never automatic; it proposes the catalogue articles of the same type, material and size, and the AI
 * source, when one is chosen, says which is the same article. Nothing is merged: « c'est cet article » writes
 * the catalogue's reference in the row the screen holds, so the import skips it and its supplier references
 * attach to the existing article.
 */

type Item = CostingWorkbookSuggestionsResponseOf<"articles">["items"][number];
type Found = { row: number; article: CostingWorkbookArticle; item: Item };
export type DuplicateSearch = {
  found: Found[];
  searched: number;
  status: CostingWorkbookSuggestionsResponseOf<"articles">["status"];
  message: string;
};

export function ArticleDuplicates({ proposed, idColumn, search, onSearch }: Readonly<{
  proposed: ReadonlyArray<{ row: number; article: CostingWorkbookArticle }>;
  /** The column of the article identifier; without it nothing can be written. */
  idColumn: number | undefined;
  /** Kept by the preview: the result outlives the view. */
  search: DuplicateSearch | null;
  onSearch: (search: DuplicateSearch | null) => void;
}>) {
  const { busy, applyEdits, rows, revision, isCurrentRevision } = useWorkbookEditor();
  const { provider } = useWorkbookAssistant();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), [revision]);

  async function run() {
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setProgress(0);
    const found: Found[] = [];
    let status: DuplicateSearch["status"] = "deterministic";
    let message = "";
    try {
      const size = COSTING_WORKBOOK_SUGGESTION_LIMITS.articles;
      for (let start = 0; start < proposed.length; start += size) {
        const chunk = proposed.slice(start, start + size);
        const answer = await requestWorkbookSuggestions({
          task: "articles",
          ...(provider ? { provider } : {}),
          lines: chunk.map(({ row, article }) => ({
            key: String(row),
            reference: article.reference.slice(0, 255),
            wording: article.designation.slice(0, 500),
            material: article.material ?? "",
            dimension: article.dimensions ?? "",
            unit: article.unit.slice(0, 40),
          })),
        }, abort.signal);
        if (abort.signal.aborted || !isCurrentRevision(revision)) return;
        const byRow = new Map(chunk.map((entry) => [String(entry.row), entry]));
        for (const item of answer.items) {
          const entry = byRow.get(item.key);
          if (entry && item.candidates.length > 0) found.push({ ...entry, item });
        }
        if (answer.status !== "deterministic" && answer.status !== "available") status = answer.status;
        else if (status === "deterministic") status = answer.status;
        if (answer.message) message = answer.message;
        setProgress(Math.min(start + size, proposed.length));
        onSearch({ found: [...found], searched: Math.min(start + size, proposed.length), status, message });
        // A source that failed is not asked again: the rest is searched by the rules alone at the next request.
        if (answer.status === "failed" || answer.status === "unavailable") break;
      }
    } catch (failure) {
      if (!abort.signal.aborted) setError(catalogueErrorMessage(failure, "La recherche de doublons n’a pas abouti."));
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setProgress(null);
      }
    }
  }

  const found = search?.found ?? [];
  const current = boundedPage(page, found.length);
  const start = current * DECISIONS_PER_PAGE;
  const running = progress !== null;
  const requestCount = Math.ceil(proposed.length / COSTING_WORKBOOK_SUGGESTION_LIMITS.articles);

  return (
    <section aria-labelledby="costing-workbook-duplicates-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="costing-workbook-duplicates-title" className="typo-h3">
          {search
            ? `${formatCount(found.length)} ${plural(found.length, "brouillon ressemble", "brouillons ressemblent")} à un article du catalogue`
            : "Doublons possibles"}
        </h3>
        <ReviewPager page={current} total={found.length} onSelect={setPage} />
      </div>
      <p className="text-sm text-muted-foreground">
        L’import compare les références. Un article déjà saisi au catalogue sous une autre référence serait créé une
        seconde fois : la recherche le rapproche par son type, sa matière et sa dimension.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SuggestButton
          label={search ? "Chercher à nouveau" : "Chercher les doublons"}
          withAi
          loading={running}
          disabled={busy || proposed.length === 0}
          onClick={() => void run()}
        />
        {running ? (
          <>
            <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
              {`${formatCount(progress)} sur ${formatCount(proposed.length)} articles comparés`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>Arrêter</Button>
          </>
        ) : null}
      </div>
      {provider === "personal_api_key" && requestCount > 1 ? (
        <p className="text-xs text-muted-foreground">
          {`Cette recherche peut envoyer ${requestCount} demandes et coûter jusqu’à ${formatUsdCeiling(requestCount * MODEL_TEST_CEILING_NANO_USD)} au total.`}
        </p>
      ) : null}
      {provider === "decisions" && requestCount > 1 ? (
        <p className="text-xs text-muted-foreground">{`Cette recherche peut envoyer jusqu’à ${requestCount} appels Decisions.`}</p>
      ) : null}
      {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
      {search ? <SuggestionStatus status={search.status} message={search.message} /> : null}
      {search && found.length === 0 && !running ? (
        <p className="text-sm text-muted-foreground">
          {`Aucun des ${formatCount(search.searched)} brouillons comparés ne ressemble à un article du catalogue.`}
        </p>
      ) : null}
      {found.length > 0 ? (
        <ul aria-label="Doublons possibles" className="divide-y divide-border rounded-md border border-border">
          {found.slice(start, start + DECISIONS_PER_PAGE).map(({ row, article, item }) => {
            const chosen = item.suggestion?.product_id ?? null;
            return (
              <li key={row} className="space-y-2 px-3 py-3 text-sm">
                <p className="wrap-anywhere">
                  <span className="text-xs text-muted-foreground">{`Ligne ${row} · `}</span>
                  <span className="font-mono text-xs">{article.reference}</span> {article.designation}
                </p>
                {item.suggestion && chosen === null ? (
                  <p className="text-xs text-muted-foreground">
                    {`L’IA n’y reconnaît aucun de ces articles (${confidenceLabel(item.suggestion.confidence)}).`}
                  </p>
                ) : null}
                <ul className="space-y-1.5">
                  {item.candidates.map((candidate) => {
                    const suggested = candidate.product_id === chosen;
                    const sure = suggested && (item.suggestion?.source === "match" || (item.suggestion?.confidence ?? 0) >= RETAINED_CONFIDENCE);
                    return (
                      <li key={candidate.product_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded border border-border px-2 py-1.5">
                        <div className="min-w-0 space-y-0.5">
                          <p className="wrap-anywhere">
                            <span className="font-mono text-xs">{candidate.reference ?? "Sans référence"}</span> {candidate.designation}
                            {suggested ? (
                              <Badge variant={sure ? "success" : "info"} size="sm" className="ml-2">
                                {item.suggestion?.source === "ai" ? `IA · ${confidenceLabel(item.suggestion.confidence)}` : "même article"}
                              </Badge>
                            ) : null}
                          </p>
                          {candidate.reasons.length > 0 ? <p className="text-xs text-muted-foreground">{candidate.reasons.join(" · ")}</p> : null}
                          {candidate.warnings.length > 0 ? <p className="text-xs text-warning">{candidate.warnings.join(" · ")}</p> : null}
                        </div>
                        <Button
                          variant={suggested ? "secondary" : "outline"}
                          size="xs"
                          disabled={busy || idColumn === undefined || !candidate.reference}
                          title={candidate.reference ? "Écrit la référence du catalogue dans cette ligne : l’import ne crée pas l’article" : "Cet article du catalogue n’a pas de référence"}
                          aria-label={`Ne pas créer ${article.reference} : c’est ${candidate.reference ?? candidate.designation}`}
                          onClick={() => {
                            if (isCurrentRevision(revision) && idColumn !== undefined && candidate.reference
                              && workbookCellText(rows, row, idColumn) === article.reference) applyEdits([{ row, column: idColumn, value: candidate.reference }]);
                          }}
                        >
                          C’est cet article
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
