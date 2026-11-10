"use client";

import Link from "next/link";
import { useId, useState } from "react";

import {
  APPLY_GUARD_REASON_LABELS,
  type ApplyGuardResult,
  type GuardBlockedItem,
} from "@/lib/takeoff/guards";
import { FORCE_REASON_CODES, type ForceReason } from "@/lib/takeoff/force-reason-codes";
import { FORCE_REASONS } from "@/lib/takeoff/force-reason-labels";
import { forceReasonsFor, forceRulesOf } from "@/lib/takeoff/force-reasons";
import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";
import { ACCEPTANCE_NOTE, noteLength, validNote } from "@/lib/takeoff/rules/acceptance-note";

import {
  falsePositiveRules,
  forcedDraftOf,
  forcedEntryOf,
  forcedOverrideOf,
  type ForcedDraft,
  type ForcedDrafts,
} from "./forced-drafts";
import { confidenceColor, formatConfidencePercent } from "./shared";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

const SELECT_CLASS = "w-full rounded-md border border-border bg-surface p-2 text-sm";

/** A justification counted as the server counts it (code points, without the blanks at its ends). */
function JustificationCount({ id, value }: Readonly<{ id: string; value: string }>) {
  const length = noteLength(value);
  const valid = validNote(value);
  return (
    <p id={id} className={cn("mt-1 text-right text-xs tabular-nums", valid || value === "" ? "text-muted-foreground" : "text-danger")}>
      {length}/{ACCEPTANCE_NOTE.max} caractères (au moins {ACCEPTANCE_NOTE.min})
    </p>
  );
}

/** TI-686 D10: one blocked line's coded reason, rules at fault and justification. */
function ForcedLine({ line, draft, onChange }: Readonly<{
  line: GuardBlockedItem; draft: ForcedDraft; onChange: (next: ForcedDraft) => void;
}>) {
  const id = useId();
  const reasons = forceReasonsFor(line);
  const rules = forceRulesOf(line);
  const chosenRules = falsePositiveRules(line, draft);
  const result = forcedEntryOf(line, draft);
  const complete = "entry" in result;
  return (
    <li className="space-y-2 border-t border-border py-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <input id={`${id}-selected`} type="checkbox" checked={draft.selected}
          onChange={(event) => onChange({ ...draft, selected: event.target.checked })} />
        <label htmlFor={`${id}-selected`} className="text-sm font-medium text-foreground">{line.designation}</label>
        <span className={cn("ml-auto text-xs", complete ? "text-success" : "text-muted-foreground")} role="status">
          {complete ? "Complète" : "À compléter"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-foreground-secondary">Motif</label>
          <select id={`${id}-reason`} aria-label={`Motif : ${line.designation}`} className={SELECT_CLASS} value={draft.reason}
            onChange={(event) => onChange({ ...draft, reason: event.target.value as ForceReason | "", rules: [] })}>
            <option value="">Choisir un motif</option>
            {reasons.map((code) => <option key={code} value={code}>{FORCE_REASONS[code]}</option>)}
          </select>
          {draft.reason === "rule_false_positive" && rules.length > 1 ? (
            <fieldset className="mt-2">
              <legend className="text-xs font-medium text-foreground-secondary">Règle fautive</legend>
              {rules.map((rule) => (
                <label key={rule} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={draft.rules.includes(rule)} aria-label={`Règle fautive : ${TAKEOFF_RULE_LABELS[rule]}`}
                    onChange={(event) => onChange({ ...draft, rules: event.target.checked
                      ? [...draft.rules, rule] : draft.rules.filter((other) => other !== rule) })} />
                  {TAKEOFF_RULE_LABELS[rule]}
                </label>
              ))}
            </fieldset>
          ) : draft.reason === "rule_false_positive" && chosenRules.length === 1 ? (
            <p className="mt-2 text-xs text-muted-foreground">Règle fautive : {TAKEOFF_RULE_LABELS[chosenRules[0]]}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${id}-justification`} className="block text-xs font-medium text-foreground-secondary">Justification</label>
          <Textarea id={`${id}-justification`} aria-label={`Justification : ${line.designation}`} rows={2} className="w-full text-sm"
            value={draft.justification} aria-describedby={`${id}-count`} autoComplete="off"
            onChange={(event) => onChange({ ...draft, justification: event.target.value })} />
          <JustificationCount id={`${id}-count`} value={draft.justification} />
        </div>
      </div>
      {"error" in result && result.error ? <p className="text-xs text-danger">{result.error}</p> : null}
    </li>
  );
}

export function GuardPanel({
  guardResult,
  isAdmin,
  canOverride,
  forcedDrafts,
  onReturnToReview,
  reviewHref,
  targetedReviewHref,
  onForcedDraftsChange,
  onOverrideConfirm,
}: {
  guardResult: ApplyGuardResult;
  isAdmin: boolean;
  canOverride: boolean;
  /** TI-686 D10: what the administrator wrote for each blocked line, kept by the wizard. */
  forcedDrafts: ForcedDrafts;
  onReturnToReview?: () => void;
  reviewHref?: string;
  /** The targeted review of the job (TI-664 L5c), where each blocked line is settled. */
  targetedReviewHref?: string;
  onForcedDraftsChange: (next: ForcedDrafts) => void;
  onOverrideConfirm: () => void;
}) {
  const bulkId = useId();
  const [bulk, setBulk] = useState<{ reason: ForceReason | ""; justification: string }>({ reason: "", justification: "" });
  const blocked = guardResult.blocked_items;
  const selected = blocked.filter((line) => forcedDraftOf(forcedDrafts, line.item_id).selected);
  // The reasons every selected line accepts (the unconditional ones at least).
  const bulkReasons = FORCE_REASON_CODES
    .filter((code) => selected.every((line) => forceReasonsFor(line).includes(code)));
  const complete = forcedOverrideOf(blocked, forcedDrafts) !== null;
  const setDraft = (itemId: string, next: ForcedDraft) => onForcedDraftsChange({ ...forcedDrafts, [itemId]: next });
  // One reason and one text copied to the selected lines; the request stores the text once.
  const applyToSelection = () => onForcedDraftsChange(Object.fromEntries(blocked.map((line) => {
    const draft = forcedDraftOf(forcedDrafts, line.item_id);
    return [line.item_id, draft.selected && bulk.reason !== ""
      ? { ...draft, reason: bulk.reason, rules: draft.reason === bulk.reason ? draft.rules : [], justification: bulk.justification }
      : draft];
  })));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning bg-warning-light p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning">
          <span aria-hidden="true">&#9888;</span> Lignes à trancher
        </p>
        <p className="mt-2 text-sm text-foreground-secondary">
          {guardResult.blocked_items.length} item
          {guardResult.blocked_items.length > 1 ? "s sont bloqués" : " est bloqué"} :
          preuve absente, page source introuvable, restriction technique
          ou règles à recalculer.
          Revenez à la revue pour trancher chaque ligne avant application.
        </p>
        {onReturnToReview ? (
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline" }), "mt-3")}
            onClick={onReturnToReview}
          >
            Retour à la revue
          </button>
        ) : reviewHref ? (
          <Link href={reviewHref} className={cn(buttonVariants({ variant: "outline" }), "mt-3 inline-flex")}>
            Ouvrir la revue des preuves
          </Link>
        ) : null}
        {targetedReviewHref ? (
          <Link href={targetedReviewHref} className={cn(buttonVariants({ variant: "outline" }), "ml-2 mt-3 inline-flex")}>
            Trancher dans la revue ciblée
          </Link>
        ) : null}
      </div>

      <div className="max-h-[200px] overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2">Blocage</th>
              <th className="px-3 py-2 text-center">Confiance</th>
            </tr>
          </thead>
          <tbody>
            {guardResult.blocked_items.map((blocked) => (
              <tr
                key={blocked.item_id}
                className="border-t border-border"
              >
                <td className="px-3 py-2 text-foreground">
                  {blocked.designation}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {blocked.reasons
                    .map((reason) => APPLY_GUARD_REASON_LABELS[reason])
                    .join(" · ")}
                  {/* TI-664 L5c: each failed rule with its reason (the Z1/Z2 length and the other zone's line). */}
                  {blocked.rule_failures?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {blocked.rule_failures.map((failure) => (
                        <li key={failure.rule}>
                          <span className="font-medium text-foreground-secondary">{TAKEOFF_RULE_LABELS[failure.rule]}</span>
                          {" : "}{failure.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td
                  className={`px-3 py-2 text-center font-semibold ${confidenceColor(blocked.confidence)}`}
                >
                  {formatConfidencePercent(blocked.confidence)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {guardResult.medium_items.length > 0 && (
        <div className="rounded-xl border border-info bg-info-light p-3">
          <p className="text-xs font-semibold text-info">
            Contrôle recommandé (non bloquant)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {guardResult.medium_items.length} élément(s) présentent une confiance à confirmer ou un avertissement de quantité.
            Un contrôle humain reste recommandé, sans acquittement individuel.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-info">
              Voir les items ({guardResult.medium_items.length})
            </summary>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {guardResult.medium_items.map((medium) => (
                <li key={medium.item_id} className="flex items-center justify-between">
                  <span>{medium.designation}</span>
                  <span className={`font-semibold ${confidenceColor(medium.confidence)}`}>
                    {formatConfidencePercent(medium.confidence)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {isAdmin && (
        <div className="rounded-xl border border-danger bg-error-light p-4">
          <p className="text-xs font-semibold text-danger">
            Forcer l&apos;application
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Chaque ligne forcée reçoit un motif codé et une justification ({ACCEPTANCE_NOTE.min} à {ACCEPTANCE_NOTE.max}{" "}
            caractères), enregistrés dans le journal d&apos;audit. Le forçage contourne les blocages ci-dessus sans
            remplacer les preuves manquantes. Chaque ligne levée entre au devis comme provision interne ; le forçage
            n&apos;apparaît jamais dans le devis client.
          </p>

          <fieldset className="mt-3 space-y-2 rounded-lg border border-border bg-surface p-3">
            <legend className="px-1 text-xs font-medium text-foreground-secondary">
              Sélection ({selected.length}/{blocked.length})
            </legend>
            <label htmlFor={`${bulkId}-reason`} className="block text-xs font-medium text-foreground-secondary">
              Motif de la sélection
            </label>
            <select id={`${bulkId}-reason`} className={SELECT_CLASS} value={bulk.reason}
              onChange={(event) => setBulk({ ...bulk, reason: event.target.value as ForceReason | "" })}>
              <option value="">Choisir un motif</option>
              {bulkReasons.map((code) => <option key={code} value={code}>{FORCE_REASONS[code]}</option>)}
            </select>
            <label htmlFor={`${bulkId}-justification`} className="block text-xs font-medium text-foreground-secondary">
              Justification de la sélection
            </label>
            <Textarea id={`${bulkId}-justification`} name="takeoff-apply-forced-justification" className="w-full text-sm" rows={2}
              placeholder="Dites ce qui a été contrôlé et le risque accepté…" value={bulk.justification}
              aria-describedby={`${bulkId}-count`} autoComplete="off"
              onChange={(event) => setBulk({ ...bulk, justification: event.target.value })} />
            <JustificationCount id={`${bulkId}-count`} value={bulk.justification} />
            <button type="button" className={buttonVariants({ variant: "outline" })} onClick={applyToSelection}
              disabled={selected.length === 0 || bulk.reason === "" || !bulkReasons.includes(bulk.reason)
                || !validNote(bulk.justification)}>
              Appliquer à la sélection
            </button>
          </fieldset>

          <ul className="mt-3 max-h-[320px] overflow-auto rounded-lg border border-border bg-surface px-3">
            {blocked.map((line) => (
              <ForcedLine key={line.item_id} line={line} draft={forcedDraftOf(forcedDrafts, line.item_id)}
                onChange={(next) => setDraft(line.item_id, next)} />
            ))}
          </ul>

          <button
            type="button"
            className={cn(buttonVariants({ variant: "danger-solid" }), "mt-3")}
            onClick={onOverrideConfirm}
            disabled={!canOverride || !complete}
          >
            Forcer l&apos;application ({blocked.length} ligne{blocked.length > 1 ? "s" : ""})
          </button>
          {!canOverride ? (
            <p className="mt-2 text-xs text-danger" role="status">
              Un aperçu d’impact à jour est requis avant tout forçage.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
