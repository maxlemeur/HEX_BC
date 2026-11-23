"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Info, Link2, Link2Off, Search, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
  MaterialRequestProductMatch,
} from "@/lib/material-requests/contracts";
import { aliasKey } from "@/lib/material-requests/matching";
import { plural } from "@/lib/text/plural";
import { cn } from "@/lib/utils";

import {
  ARTICLE_LINK_HELD,
  type ArticleNotice,
  type LineChangeState,
  type LineProposals,
  type SaveResult,
} from "./useMaterialRequestEditor";

/** How the line was linked, when it tells the operator something; a ranked pick says nothing more. */
export const MATCH_LABELS: Partial<Record<MaterialRequestProductMatch, string>> = {
  reference: "par la référence",
  alias: "par un nom usuel",
  manual: "choisi à la main",
  created: "créé depuis cette ligne",
};

export const REOPENS_ON_LINK = "La ligne repassera en brouillon.";

/** Why the line cannot be linked right now, or null. */
export function articleLinkHold(change: LineChangeState | undefined): string | null {
  if (change === "failed") return ARTICLE_LINK_HELD;
  if (change === "saving") return "Enregistrement de la ligne en cours : rattachement possible dès qu’il est terminé.";
  return null;
}

/**
 * The line's type words, when linking it to this article could teach them as a usual name (TI-691): the server
 * learns them only when the office checks the choice, and not when they already say the article's type or
 * designation. Null when there is nothing to learn. The words are the line's own: an unlinked line carries the
 * technician's wording (an unlink gives it back).
 */
export function learnableWords(words: string | null, article?: Pick<MaterialRequestArticleSummary, "product_type" | "designation">): string | null {
  const trimmed = words?.trim() ?? "";
  const key = aliasKey(trimmed);
  if (!key || trimmed.length > 200) return null;
  if (article && (key === aliasKey(article.product_type) || key === aliasKey(article.designation))) return null;
  return trimmed;
}

/** What a usual name does, said under the choice that teaches it. */
export const LEARN_ALIAS_HINT = "Pour toute l’équipe : les prochaines demandes qui l’écrivent proposeront cet article.";

/** « Mémoriser « coude 90 » comme nom usuel »: unchecked unless the office checks it. */
export function LearnAliasChoice({
  words,
  checked,
  onChange,
  ariaLabel,
  hint = LEARN_ALIAS_HINT,
  size = "xs",
  concise = false,
}: Readonly<{
  words: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible words, and what tells this choice from its neighbours (« ligne 2 »). */
  ariaLabel?: string;
  hint?: string;
  size?: "xs" | "sm";
  concise?: boolean;
}>) {
  const hintId = useId();
  return (
    <div className={cn("space-y-0.5", size === "xs" ? "text-xs" : "text-sm", concise && "flex items-center gap-1.5 space-y-0")}>
      <label className="flex items-start gap-1.5 text-foreground-secondary">
        <input
          type="checkbox"
          className={cn("shrink-0 accent-primary", size === "xs" ? "mt-px size-3.5" : "mt-0.5 size-4")}
          checked={checked}
          aria-label={ariaLabel ?? (concise ? `Mémoriser « ${words} » comme nom usuel` : undefined)}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="min-w-0 break-words">{concise ? "Mémoriser comme nom usuel" : <>Mémoriser « {words} » comme nom usuel</>}</span>
      </label>
      <p id={hintId} className={cn("text-xs text-muted-foreground", concise && "sr-only")}>
        {hint}
      </p>
      {concise ? (
        <Tooltip>
          <TooltipTrigger type="button" aria-label="Effet de la mémorisation"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <Info className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>« {words} » · {hint}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * What a linked article leaves to every line that uses it (TI-691): a missing material is asked on each line, and a
 * missing size is read as « sans dimension ». Completing the article once serves the next lines.
 */
export function IncompleteArticle({
  article,
  canEditCatalogue,
}: Readonly<{
  article: MaterialRequestArticleSummary;
  canEditCatalogue: boolean;
}>) {
  const missing = [article.material?.trim() ? null : "matière", article.dimensions?.trim() ? null : "dimension"].filter(
    (entry): entry is string => entry !== null,
  );
  if (missing.length === 0) return null;
  const sheetHref = `/dashboard/products?product_id=${encodeURIComponent(article.id)}`;
  const linkClass =
    "font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring";
  if (!canEditCatalogue) {
    return (
      <p className="text-xs text-muted-foreground">
        {`Fiche de l’article sans ${missing.join(" ni ")} : un administrateur ou un ingénieur peut la compléter.`}
      </p>
    );
  }
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>{`Fiche de l’article sans ${missing.join(" ni ")} : complétez-la une fois, les prochaines lignes la reprendront.`}</p>
      <Link href={sheetHref} className={linkClass}>
        Compléter la fiche de l’article
      </Link>
    </div>
  );
}

/** Reference, designation, draft marks: the same reading of an article in the table and in the panel. */
export function ArticleIdentity({
  article,
  dense = false,
  inlineInSheet = false,
  explanation,
  tag,
}: Readonly<{
  article: MaterialRequestArticleSummary;
  /** What the article is to the line (« Proposé »), read before its reference in a folded row. */
  tag?: string;
  /** In a folded table row: the designation, then the reference and what describes the article on one line. */
  dense?: boolean;
  inlineInSheet?: boolean;
  explanation?: ReactNode;
}>) {
  const details = [article.product_type, article.material, article.dimensions, article.unit].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      {dense ? (
        // A folded line keeps the name alone, on one line; a proposal reads as one by its slant.
        <p
          className={cn("truncate text-sm leading-snug text-foreground", tag && "italic text-foreground-secondary")}
          title={tag ? `${tag} : ${article.designation}` : article.designation}
        >
          {article.designation}
        </p>
      ) : (
        <>
          <div className={cn(inlineInSheet && "sheet:flex sheet:flex-wrap sheet:items-baseline sheet:gap-x-2")}>
            <p className="break-all font-mono text-xs text-foreground-secondary">{article.reference ?? "Sans référence"}</p>
            <p className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">{article.designation}</p>
          </div>
          {details || explanation ? (
            <div className={cn(inlineInSheet && "sheet:mt-0.5 sheet:flex sheet:flex-wrap sheet:items-baseline sheet:gap-x-3")}>
              {details ? <p className={cn("mt-0.5 break-words text-xs text-muted-foreground", inlineInSheet && "sheet:mt-0")}>{details}</p> : null}
              {explanation}
            </div>
          ) : null}
        </>
      )}
      {article.catalogue_status === "draft" && !dense ? (
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="warning" size="sm">
            Brouillon
          </Badge>
          {article.created_from_material_request ? (
            <Badge variant="info" size="sm">
              Nouveau
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Why a proposal is made, and what to check before choosing it: both read before the click. */
export function CandidateReasons({
  candidate,
  warningsId,
  inlineInSheet = false,
}: Readonly<{
  candidate: MaterialRequestArticleCandidate;
  warningsId: string;
  inlineInSheet?: boolean;
}>) {
  return (
    <>
      {candidate.reasons.length > 0 ? (
        <ul className={cn("mt-1 space-y-0.5 text-xs text-muted-foreground", inlineInSheet && "sheet:mt-0 sheet:flex sheet:flex-wrap sheet:gap-x-3 sheet:space-y-0")}>
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {candidate.warnings.length > 0 ? (
        <ul id={warningsId} className={cn("mt-1 space-y-0.5 text-xs font-medium text-warning", inlineInSheet && "sheet:basis-full")}>
          {candidate.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1">
              <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              À vérifier : {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Notice({ notice, className }: Readonly<{ notice: ArticleNotice | undefined; className?: string }>) {
  return (
    <div role="status" className={cn("text-xs text-success empty:hidden", className)}>
      {notice && notice.filled.length > 0 ? <p>Repris de l’article : {notice.filled.join(", ")}.</p> : null}
      {notice?.aliasLearned ? <p>Nom usuel mémorisé : « {notice.aliasLearned} »</p> : null}
      {notice?.reopened ? <p className="text-warning">Ligne repassée en brouillon.</p> : null}
      {notice?.quantityToCheck ? (
        <p className="text-warning">Unité changée pour celle de l’article : vérifiez la quantité.</p>
      ) : null}
    </div>
  );
}

type ArticleCellProps = Readonly<{
  line: MaterialRequestLine;
  article: MaterialRequestArticleSummary | null;
  canWrite: boolean;
  proposals: LineProposals;
  change: LineChangeState | undefined;
  notice: ArticleNotice | undefined;
  /** The server's sentence when the line changed since it was read; the request was read again. */
  conflict: string | undefined;
  onLink: (candidate: MaterialRequestArticleCandidate, learnAlias: boolean) => Promise<SaveResult>;
  onUnlink: () => Promise<SaveResult>;
  onOpenPanel: () => void;
  onRetryProposals: () => void;
  /** May complete the linked article's sheet (admins and engineers). */
  canEditCatalogue?: boolean;
  compact?: boolean;
  compactProposal?: boolean;
  /**
   * False in a folded row of the lines: the article and the gesture that links it stay in view. In the sheet that is
   * one line, in a card as in the sheet; the reference, the reasons and the other gestures are read once the line is unfolded.
   */
  expanded?: boolean;
}>;

/**
 * The « Article » column of a line (TI-690, delivery 3). Linked: the article, how, and « Délier ».
 * Not linked: its best proposal with its reasons and warnings, linked by one gesture; nothing is linked
 * without it. A reader sees the article and nothing that writes.
 */
export function MaterialRequestArticleCell({
  line,
  article,
  canWrite,
  proposals,
  change,
  notice,
  conflict,
  onLink,
  onUnlink,
  onOpenPanel,
  onRetryProposals,
  canEditCatalogue = false,
  compact = false,
  expanded = true,
  compactProposal = false,
}: ArticleCellProps) {
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The proposal for which the office checked « Mémoriser … comme nom usuel »: another proposal starts unchecked. */
  const [learnFor, setLearnFor] = useState<string | null>(null);
  const n = line.position;
  const validated = line.status === "validated";
  const holdId = `${ids}-hold`;
  const warningsId = `${ids}-warnings`;
  const dense = !expanded && !compact;
  /** A folded line holds its article on one line: what does not fit wraps under it only when there is something to say. */
  // In a card the line is as tall as the supplier's select beside it, so that the two read on one baseline.
  const oneLine = dense && "flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 space-y-0 sheet:min-h-7";
  const underLine = dense && "basis-full";

  const act = async (action: () => Promise<SaveResult>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    // `blocked`: the editor already keeps the reason beside the line (`conflict`).
    setError(result.ok || result.blocked ? null : result.message);
  };
  const shownError = error ?? conflict ?? null;

  if (line.product_id) {
    const how = line.product_match ? MATCH_LABELS[line.product_match] : undefined;
    return (
      <div className={cn("space-y-1.5", oneLine)}>
        {dense && article ? (
          // Folded, the article is its name: what unlinks it is read once the line is unfolded.
          <div className="min-w-0 flex-1">
            <ArticleIdentity article={article} dense />
          </div>
        ) : !compact ? (
          article ? <ArticleIdentity article={article} /> : <p className="text-sm text-foreground">Article rattaché</p>
        ) : null}
        {how && !compact && !(dense && article) ? <p className="text-xs text-muted-foreground">{how}</p> : null}
        <Notice notice={notice} className={underLine || undefined} />
        {article && canWrite && !compact && !dense ? <IncompleteArticle article={article} canEditCatalogue={canEditCatalogue} /> : null}
        {canWrite ? (
          <>
            {dense && article ? null : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                loading={busy}
                aria-label={`Délier l’article de la ligne ${n}`}
                aria-describedby={validated ? holdId : undefined}
                onClick={() => void act(onUnlink)}
              >
                <Link2Off aria-hidden="true" />
                Délier
              </Button>
            )}
            {validated ? (
              <p id={holdId} className="text-xs text-muted-foreground">
                {REOPENS_ON_LINK}
              </p>
            ) : null}
          </>
        ) : null}
        {shownError ? (
          <p role="alert" className={cn("text-xs font-medium text-danger", underLine)}>
            {shownError}
          </p>
        ) : null}
      </div>
    );
  }

  if (!canWrite) return <span className="text-sm text-subtle-foreground">—</span>;

  const first = proposals.status === "ready" ? proposals.candidates[0] : undefined;
  const learnable = first ? learnableWords(line.product_type, first.article) : null;
  const learn = first !== undefined && learnable !== null && learnFor === first.article.id;
  const hold = articleLinkHold(change);
  /*
   * Invariant: nothing with a warning is linked without its warnings on screen at the moment of the click. A folded
   * row keeps a proposal with warnings to one line saying how many points there are to check, and its only gesture
   * opens the proposals panel, where the candidate is read with every warning before « Rattacher ». Unfolded, the row
   * lists the warnings beside its direct link, as before.
   */
  const toCheck = dense && first !== undefined && first.warnings.length > 0;
  const toCheckId = `${ids}-to-check`;
  const describedBy = [first && first.warnings.length > 0 ? warningsId : null, !dense && (hold || validated) ? holdId : null]
    .filter(Boolean)
    .join(" ");

  const wide = compactProposal && Boolean(first);
  const waiting = cn("text-xs text-muted-foreground", dense && "min-w-0 flex-1 truncate");
  return (
    <div className={cn("space-y-1.5", oneLine, wide && "sheet:grid sheet:grid-cols-[minmax(0,1fr)_auto] sheet:gap-x-3 sheet:gap-y-1 sheet:space-y-0")}>
      {proposals.status === "loading" ? <p className={waiting}>Recherche d’articles…</p> : null}
      {proposals.status === "stale" ? <p className={waiting}>Mise à jour des propositions…</p> : null}
      {proposals.status === "error" ? (
        <div className={cn("text-xs text-muted-foreground", dense && "flex min-w-0 flex-1 items-center gap-2")}>
          <p>Propositions indisponibles.</p>
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onRetryProposals}>
            Réessayer
          </Button>
        </div>
      ) : null}
      {proposals.status === "ready" && !first ? (
        <p className={cn("text-xs text-muted-foreground", dense && "sr-only")}>Aucun article proposé.</p>
      ) : null}
      {first ? (
        // A proposal is not an alert: its box stays neutral, and only what there is to check takes the warning colour.
        <div
          className={cn(
            "rounded-md border border-dashed border-border-strong bg-surface-subtle px-2 py-1.5",
            dense && "min-w-0 flex-1 border-0 bg-transparent p-0",
            wide && "sheet:col-start-1 sheet:row-span-2 sheet:row-start-1 sheet:rounded-none sheet:border-0 sheet:bg-transparent sheet:p-0",
          )}
        >
          {dense ? null : <p className={cn("text-micro font-semibold uppercase text-muted-foreground", wide && "sheet:sr-only")}>Proposé</p>}
          <ArticleIdentity article={first.article} dense={dense} inlineInSheet={wide} tag={dense ? "Proposé" : undefined}
            explanation={dense ? undefined : <CandidateReasons candidate={first} warningsId={warningsId} inlineInSheet={wide} />} />
        </div>
      ) : null}
      {/* With warnings, a folded row leaves the usual-name choice to the panel, which offers it beside the candidate. */}
      {/* Folded, a line keeps one gesture beside its proposal: the usual-name choice is read once it is unfolded. */}
      {first && learnable && !dense ? (
        <div className={cn(wide && "sheet:col-start-2 sheet:row-start-1 sheet:justify-self-end")}>
          <LearnAliasChoice
            words={learnable}
            checked={learn}
            concise={wide}
            ariaLabel={`Mémoriser « ${learnable} » comme nom usuel, ligne ${n}`}
            onChange={(checked) => setLearnFor(checked ? first.article.id : null)}
          />
        </div>
      ) : null}
      {!dense && (hold || (first && validated)) ? (
        <p id={holdId} className={cn("text-xs", hold ? "font-medium text-danger" : "text-muted-foreground", wide && "sheet:col-span-full")}>
          {hold ?? REOPENS_ON_LINK}
        </p>
      ) : null}
      <div className={cn("flex flex-wrap gap-1", toCheck && "items-center gap-x-2", dense && "shrink-0 flex-nowrap",
        wide && "sheet:col-start-2 sheet:row-start-2 sheet:justify-end")}>
        {toCheck ? (
          <>
            {/* How many points, on the line of the gesture that reads them; in the sheet the mark says there are some. */}
            <p
              id={toCheckId}
              className="flex items-center gap-1 text-xs font-medium text-warning"
              title={plural(first.warnings.length, "point à vérifier", "points à vérifier")}
            >
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only">{plural(first.warnings.length, "point à vérifier", "points à vérifier")}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={`Vérifier l’article proposé, ligne ${n}`}
              aria-describedby={toCheckId}
              onClick={onOpenPanel}
            >
              Vérifier
            </Button>
          </>
        ) : null}
        {first && !toCheck ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            loading={busy}
            disabled={hold !== null}
            aria-label={`Rattacher l’article proposé à la ligne ${n}`}
            aria-describedby={describedBy || undefined}
            title={hold ?? undefined}
            onClick={() => void act(() => onLink(first, learn))}
          >
            {dense ? null : <Link2 aria-hidden="true" />}
            Rattacher
          </Button>
        ) : null}
        {/* Folded, a line keeps one gesture beside a proposal: the other proposals are a click away, unfolded. */}
        {dense && first ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={first ? `Autres propositions, ligne ${n}` : `Chercher ou créer l’article, ligne ${n}`}
            onClick={onOpenPanel}
          >
            <Search aria-hidden="true" />
            {first ? "Autres propositions" : "Chercher ou créer"}
          </Button>
        )}
      </div>
      <Notice notice={notice} className={cn(underLine, wide && "sheet:col-span-full")} />
      {shownError ? (
        <p role="alert" className={cn("text-xs font-medium text-danger", underLine, wide && "sheet:col-span-full")}>
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
