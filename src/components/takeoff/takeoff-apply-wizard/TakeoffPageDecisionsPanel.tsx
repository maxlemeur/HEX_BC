"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS,
  TAKEOFF_PAGE_KEEP_BOTH_REASONS,
  TAKEOFF_PAGE_NOTE_MAX,
  type TakeoffPageKeepBothReason,
  type TakeoffPageReplacementResponse,
  type TakeoffPageReplacementRow,
} from "@/lib/takeoff/page-replacement-contracts";

import { initialPageDraft, pageMissing, pageOutcome, type PageContext, type PageDraft } from "./page-decisions";

// TI-682 lot D, PR 2: « Pages déjà au devis », at the application's confirmation. For each page another takeoff already
// brought into the estimate, the estimator replaces its earlier measure (recommended, preselected) or keeps both with a
// reason. Replacing updates the earlier lines in place: their title, price, category and settings stay; only their
// quantity takes the new measure. The pairs the server proposes are shown and can be corrected; a line the new takeoff no
// longer has and a quantity changed by hand wait for the estimator's choice.

export const PAGE_DECISIONS_TITLE = "Pages déjà au devis";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
const quantity = (value: number | null) => (value === null ? "—" : quantityFormat.format(value));

type Job = TakeoffPageReplacementResponse["jobs"][number];

function pageLabel(row: TakeoffPageReplacementRow) {
  return `${row.file_name ?? "Plan sans nom"}, ${row.page === null ? "page inconnue" : `page ${row.page}`}`;
}

function earlierLabel(row: TakeoffPageReplacementRow, jobs: ReadonlyMap<string, Job>) {
  return row.earlier_job_ids.map((id) => {
    const job = jobs.get(id);
    if (!job) return "un autre métré";
    const date = new Date(job.created_at);
    return `le métré du ${Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date)}${job.level ? ` (niveau ${job.level})` : ""}`;
  }).join(" et ");
}

function PageDecision({ row, jobs, draft, context, disabled, onChange }: Readonly<{
  row: TakeoffPageReplacementRow; jobs: ReadonlyMap<string, Job>; draft: PageDraft; context: PageContext; disabled: boolean;
  onChange: (draft: PageDraft) => void;
}>) {
  const label = pageLabel(row);
  // Each line as it will be stored: a line carrying several replaced pages takes all their new measures at once.
  const outcome = pageOutcome(row, draft, context);
  const missing = pageMissing(row, draft, context);
  const titles = new Map(row.earlier_lines.map((line) => [line.id, line.title]));
  const name = `takeoff-page-${row.key}`;
  // A line that also carries another page is never removed: « remove all » leaves it waiting for « keep ».
  const setChoices = (choice: "remove" | "keep") => onChange({ ...draft,
    choices: { ...draft.choices, ...Object.fromEntries(outcome.vanished.filter((line) => choice === "keep" || !line.otherPages)
      .map((line) => [line.id, choice])) } });
  return (
    <fieldset aria-label={`Page ${label}`} className="space-y-3 rounded-lg border border-border bg-background p-3">
      <legend className="px-1 text-sm font-semibold text-foreground">{label}</legend>
      <p className="text-sm text-foreground-secondary">Déjà au devis par {earlierLabel(row, jobs)}, {plural(row.earlier_lines.length, "ligne")}.</p>
      <div role="radiogroup" aria-label={`Mesure de ${label}`} className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name={name} value="replace" checked={draft.decision === "replace"} disabled={disabled}
            onChange={() => onChange({ ...draft, decision: "replace" })} />
          Remplacer la mesure précédente (recommandé)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={name} value="keep_both" checked={draft.decision === "keep_both"}
            disabled={disabled || row.keep_both_refused !== null} onChange={() => onChange({ ...draft, decision: "keep_both" })} />
          Garder les deux
        </label>
      </div>
      {row.keep_both_refused === "dpgf_target" ? (
        <p className="text-xs text-muted-foreground">Garder les deux n’est pas possible : cette page alimente une ligne DPGF déjà alimentée par un autre métré, qui ne garde qu’une mesure.</p>
      ) : row.keep_both_refused === "merge_match" ? (
        <p className="text-xs text-muted-foreground">Garder les deux n’est pas possible : la fusion, obligatoire avec un DPGF, met une nouvelle ligne sur une ligne précédente de la page.</p>
      ) : null}

      {draft.decision === "keep_both" ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Motif</span>
            <NativeSelect aria-label={`Motif pour ${label}`} value={draft.reason ?? ""} disabled={disabled}
              onChange={(event) => onChange({ ...draft, reason: (event.target.value || null) as TakeoffPageKeepBothReason | null })}>
              <option value="">Choisir un motif…</option>
              {TAKEOFF_PAGE_KEEP_BOTH_REASONS.map((reason) => <option key={reason} value={reason}>{TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS[reason]}</option>)}
            </NativeSelect>
          </label>
          {draft.reason === "complementary_scope" ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Ce que la mesure ajoute</span>
              <Textarea aria-label={`Périmètre complémentaire pour ${label}`} value={draft.note} maxLength={TAKEOFF_PAGE_NOTE_MAX} disabled={disabled}
                onChange={(event) => onChange({ ...draft, note: event.target.value })} />
            </label>
          ) : null}
          <p className="text-xs text-muted-foreground">Les deux mesures resteront au devis, et le motif sera gardé avec le métré.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {outcome.updated.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold">Quantités mises à jour</h4>
              <ul aria-label={`Quantités mises à jour, ${label}`} className="mt-1 space-y-2 text-sm">
                {outcome.updated.map((line) => (
                  <li key={line.id} className="space-y-1">
                    <span className="font-medium">{line.title}</span> : {quantity(line.before)} → {quantity(line.after)}
                    {line.before !== null && line.after !== line.before ? ` (${line.after > line.before ? "+" : ""}${quantity(line.after - line.before)})` : ""}
                    {line.pages > 1 ? <span className="text-muted-foreground"> (quantité de la ligne sur ses {line.pages} pages remesurées)</span> : null}
                    <span className="text-muted-foreground"> — titre, prix et catégorie gardés</span>
                    {line.changedByHand ? (
                      <div role="radiogroup" aria-label={`Quantité de ${line.title}`} className="flex flex-wrap gap-4 pl-2 text-xs">
                        <span className="text-foreground-secondary">Quantité modifiée à la main :</span>
                        <label className="flex items-center gap-1">
                          <input type="radio" name={`${name}-${line.id}-take`} checked={line.take === "new"} disabled={disabled}
                            onChange={() => onChange({ ...draft, takes: { ...draft.takes, [line.id]: "new" } })} />
                          Prendre la nouvelle mesure
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="radio" name={`${name}-${line.id}-take`} checked={line.take === "keep_mine"} disabled={disabled}
                            onChange={() => onChange({ ...draft, takes: { ...draft.takes, [line.id]: "keep_mine" } })} />
                          Garder ma quantité ({quantity(line.before)})
                        </label>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h4 className="text-sm font-semibold">Lignes du nouveau métré</h4>
            <ul aria-label={`Lignes du nouveau métré, ${label}`} className="mt-1 space-y-1 text-sm">
              {row.new_lines.map((line) => {
                const locked = row.pairs.some((pair) => pair.takeoff_item_id === line.id && pair.locked);
                const allowed = new Set(line.candidate_ids);
                const candidates = row.earlier_lines.filter((earlier) => allowed.has(earlier.id));
                return (
                  <li key={line.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">{line.designation} — {quantity(line.quantity)} {line.unit}</span>
                    <NativeSelect aria-label={`Remplace, pour ${line.designation}`} wrapperClassName="w-auto" size="sm"
                      value={draft.pairs[line.id] ?? ""} disabled={disabled || locked || candidates.length === 0}
                      onChange={(event) => onChange({ ...draft, pairs: { ...draft.pairs, [line.id]: event.target.value || null } })}>
                      <option value="">Ajouter une ligne</option>
                      {candidates.map((earlier) => <option key={earlier.id} value={earlier.id}>Remplace « {earlier.title} »</option>)}
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
            {row.ambiguous_document ? (
              <p className="mt-1 text-xs text-muted-foreground">Deux plans de même nom sont au devis sur cette page : une ligne qui ne connaît que le nom de son plan n’en remplace aucune.</p>
            ) : null}
          </div>

          {outcome.vanished.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold">Lignes que le nouveau métré n’a plus</h4>
              <ul aria-label={`Lignes que le nouveau métré n’a plus, ${label}`} className="mt-1 space-y-1 text-sm">
                {outcome.vanished.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">{line.title} — {quantity(line.quantity)}</span>
                    <NativeSelect aria-label={`Choix pour ${line.title}`} wrapperClassName="w-auto" size="sm" value={line.choice ?? ""} disabled={disabled}
                      onChange={(event) => onChange({ ...draft, choices: { ...draft.choices, [line.id]: (event.target.value || null) as "remove" | "keep" | null } })}>
                      <option value="">Choisir…</option>
                      <option value="remove" disabled={line.otherPages}>
                        {line.otherPages ? "Retirer du devis (impossible : porte aussi d’autres pages)" : "Retirer du devis"}
                      </option>
                      <option value="keep">Garder</option>
                    </NativeSelect>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setChoices("remove")}>
                  Retirer les {plural(outcome.vanished.length, "ligne")}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setChoices("keep")}>
                  Garder les {plural(outcome.vanished.length, "ligne")}
                </Button>
              </div>
            </div>
          ) : null}
          {outcome.dpgfTargets.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {outcome.dpgfTargets.map((id) => `« ${titles.get(id)} »`).join(", ")} : ligne DPGF, sa quantité suit le rapprochement.
            </p>
          ) : null}
        </div>
      )}
      {missing.length > 0 ? <p role="status" className="text-xs font-medium text-warning">{missing.join(" ")}</p> : null}
    </fieldset>
  );
}

/** A choice for a quantity changed by hand belongs to the line: made on one page, it holds on every page of that line. */
function withSharedTakes(rows: readonly TakeoffPageReplacementRow[], drafts: Readonly<Record<string, PageDraft>>, key: string, draft: PageDraft) {
  const next: Record<string, PageDraft> = { ...drafts, [key]: draft };
  const before = drafts[key]?.takes ?? {};
  for (const [lineId, take] of Object.entries(draft.takes)) {
    if (take === before[lineId]) continue;
    for (const other of rows) {
      if (other.key === key || !other.earlier_lines.some((line) => line.id === lineId)) continue;
      const otherDraft = next[other.key] ?? initialPageDraft(other);
      next[other.key] = { ...otherDraft, takes: { ...otherDraft.takes, [lineId]: take } };
    }
  }
  return next;
}

export function TakeoffPageDecisionsPanel({ proposal, error, loading, drafts, strategyNotice, disabled, onDraftsChange }: Readonly<{
  proposal: TakeoffPageReplacementResponse | null;
  error: string | null;
  loading: boolean;
  drafts: Readonly<Record<string, PageDraft>>;
  strategyNotice: string | null;
  disabled: boolean;
  onDraftsChange: (drafts: Record<string, PageDraft>) => void;
}>) {
  if (error) {
    return <p role="alert" className="text-sm text-danger">{error}</p>;
  }
  if (loading && !proposal) return <p className="text-sm text-muted-foreground">Lecture des pages déjà au devis…</p>;
  if (!proposal || proposal.rows.length === 0) return null;
  const jobs = new Map(proposal.jobs.map((job) => [job.id, job]));
  return (
    <section aria-label={PAGE_DECISIONS_TITLE} className="space-y-3 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="space-y-1 text-sm">
          <h2 className="font-semibold text-foreground">{PAGE_DECISIONS_TITLE}</h2>
          <p className="text-foreground-secondary">
            Ces pages sont déjà au devis par un autre métré. Une page n’entre qu’une fois : remplacez leur mesure précédente, ou gardez les deux avec un motif.
          </p>
          {strategyNotice ? <p className="text-foreground-secondary">{strategyNotice}</p> : null}
        </div>
      </div>
      {proposal.rows.map((row) => (
        <PageDecision key={row.key} row={row} jobs={jobs} draft={drafts[row.key] ?? initialPageDraft(row)} disabled={disabled}
          context={{ rows: proposal.rows, drafts }}
          onChange={(draft) => onDraftsChange(withSharedTakes(proposal.rows, drafts, row.key, draft))} />
      ))}
      {proposal.unidentified_count > 0 ? (
        <p className="text-xs text-muted-foreground">{plural(proposal.unidentified_count, "ligne")} de ce métré sans plan ni page : non comparée{proposal.unidentified_count > 1 ? "s" : ""}.</p>
      ) : null}
    </section>
  );
}
