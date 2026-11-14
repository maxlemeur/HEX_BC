"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Link2, Link2Off, Search, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
  MaterialRequestProductMatch,
} from "@/lib/material-requests/contracts";
import { aliasKey } from "@/lib/material-requests/matching";
import { cn } from "@/lib/utils";

import {
  ARTICLE_LINK_HELD,
  type ArticleNotice,
  type LineChangeState,
  type LineProposals,
  type SaveResult,
} from "./useMaterialRequestEditor";

/** How the line was linked, when it tells the operator something; a ranked pick says nothing more. */
const MATCH_LABELS: Partial<Record<MaterialRequestProductMatch, string>> = {
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
}: Readonly<{
  words: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible words, and what tells this choice from its neighbours (« ligne 2 »). */
  ariaLabel?: string;
  hint?: string;
  size?: "xs" | "sm";
}>) {
  const hintId = useId();
  return (
    <div className={cn("space-y-0.5", size === "xs" ? "text-xs" : "text-sm")}>
      <label className="flex items-start gap-1.5 text-foreground-secondary">
        <input
          type="checkbox"
          className={cn("shrink-0 accent-primary", size === "xs" ? "mt-px size-3.5" : "mt-0.5 size-4")}
          checked={checked}
          aria-label={ariaLabel}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="min-w-0 break-words">Mémoriser « {words} » comme nom usuel</span>
      </label>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/**
 * What a linked article leaves to every line that uses it (TI-691): a missing material is asked on each line, and a
 * missing size is read as « sans dimension ». Completing the article once serves the next lines.
 */
function IncompleteArticle({
  article,
  canEditCatalogue,
}: Readonly<{ article: MaterialRequestArticleSummary; canEditCatalogue: boolean }>) {
  const missing = [article.material?.trim() ? null : "matière", article.dimensions?.trim() ? null : "dimension"].filter(
    (entry): entry is string => entry !== null,
  );
  if (missing.length === 0) return null;
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
      <Link
        href={`/dashboard/products?product_id=${encodeURIComponent(article.id)}`}
        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        Compléter la fiche de l’article
      </Link>
    </div>
  );
}

/** Reference, designation, draft marks: the same reading of an article in the table and in the panel. */
export function ArticleIdentity({ article }: Readonly<{ article: MaterialRequestArticleSummary }>) {
  const details = [article.product_type, article.material, article.dimensions, article.unit].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <p className="break-all font-mono text-xs text-foreground-secondary">{article.reference ?? "Sans référence"}</p>
      <p className="break-words text-sm font-medium leading-snug text-foreground">{article.designation}</p>
      {details ? <p className="mt-0.5 break-words text-xs text-muted-foreground">{details}</p> : null}
      {article.catalogue_status === "draft" ? (
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
}: Readonly<{ candidate: MaterialRequestArticleCandidate; warningsId: string }>) {
  return (
    <>
      {candidate.reasons.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {candidate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {candidate.warnings.length > 0 ? (
        <ul id={warningsId} className="mt-1 space-y-0.5 text-xs font-medium text-warning">
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

function Notice({ notice }: Readonly<{ notice: ArticleNotice | undefined }>) {
  return (
    <div role="status" className="text-xs text-success empty:hidden">
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
      <div className="space-y-1.5">
        {article ? <ArticleIdentity article={article} /> : <p className="text-sm text-foreground">Article rattaché</p>}
        {how ? <p className="text-xs text-muted-foreground">{how}</p> : null}
        <Notice notice={notice} />
        {article && canWrite ? <IncompleteArticle article={article} canEditCatalogue={canEditCatalogue} /> : null}
        {canWrite ? (
          <>
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
            {validated ? (
              <p id={holdId} className="text-xs text-muted-foreground">
                {REOPENS_ON_LINK}
              </p>
            ) : null}
          </>
        ) : null}
        {shownError ? (
          <p role="alert" className="text-xs font-medium text-danger">
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
  const describedBy = [first && first.warnings.length > 0 ? warningsId : null, hold || validated ? holdId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      {proposals.status === "loading" ? (
        <p className="text-xs text-muted-foreground">Recherche d’articles…</p>
      ) : null}
      {proposals.status === "stale" ? (
        <p className="text-xs text-muted-foreground">Mise à jour des propositions…</p>
      ) : null}
      {proposals.status === "error" ? (
        <div className="text-xs text-muted-foreground">
          <p>Propositions indisponibles.</p>
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onRetryProposals}>
            Réessayer
          </Button>
        </div>
      ) : null}
      {proposals.status === "ready" && !first ? (
        <p className="text-xs text-muted-foreground">Aucun article proposé.</p>
      ) : null}
      {first ? (
        <div
          className={cn(
            "rounded-md border border-dashed border-border px-2 py-1.5",
            first.warnings.length > 0 && "border-warning-border bg-warning-subtle",
          )}
        >
          <p className="text-micro font-semibold uppercase text-muted-foreground">Proposé</p>
          <ArticleIdentity article={first.article} />
          <CandidateReasons candidate={first} warningsId={warningsId} />
        </div>
      ) : null}
      {first && learnable ? (
        <LearnAliasChoice
          words={learnable}
          checked={learn}
          ariaLabel={`Mémoriser « ${learnable} » comme nom usuel, ligne ${n}`}
          onChange={(checked) => setLearnFor(checked ? first.article.id : null)}
        />
      ) : null}
      {hold || (first && validated) ? (
        <p id={holdId} className={cn("text-xs", hold ? "font-medium text-danger" : "text-muted-foreground")}>
          {hold ?? REOPENS_ON_LINK}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {first ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            loading={busy}
            disabled={hold !== null}
            aria-label={`Rattacher l’article proposé à la ligne ${n}`}
            aria-describedby={describedBy || undefined}
            onClick={() => void act(() => onLink(first, learn))}
          >
            <Link2 aria-hidden="true" />
            Rattacher
          </Button>
        ) : null}
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
      </div>
      <Notice notice={notice} />
      {shownError ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
