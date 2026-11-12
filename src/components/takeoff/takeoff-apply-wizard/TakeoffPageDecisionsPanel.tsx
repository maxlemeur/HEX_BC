"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS,
  TAKEOFF_PAGE_NOTE_MAX,
  type TakeoffPageReplacementResponse,
} from "@/lib/takeoff/page-replacement-contracts";

import {
  confirmationControls,
  resolveConfirmation,
  setConfirmationControl,
  setPageNote,
  type ConfirmationControl,
  type ConfirmationDraft,
  type ResolvedLine,
} from "./page-decisions";

// TI-682 lot D, PR 2: « Pages déjà au devis », at the application's confirmation. Codex review of 708c7fbf: the screen is
// organised as the database decides. Each page re-measured is decided once (replace its earlier measure, recommended, or
// keep both with a reason); then each earlier estimate line is shown once, with the pages it carries, the quantity it
// will hold and its own choices; then each new line once, with the line it replaces. Every control is read from
// `confirmationControls` and writes one place of the draft: what the screen shows is what is sent.

export const PAGE_DECISIONS_TITLE = "Pages déjà au devis";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
const quantity = (value: number | null) => (value === null ? "—" : quantityFormat.format(value));

type Job = TakeoffPageReplacementResponse["jobs"][number];

function earlierLabel(jobIds: readonly string[], jobs: ReadonlyMap<string, Job>) {
  return jobIds.map((id) => {
    const job = jobs.get(id);
    if (!job) return "un autre métré";
    const date = new Date(job.created_at);
    return `le métré du ${Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date)}${job.level ? ` (niveau ${job.level})` : ""}`;
  }).join(" et ");
}

const ROLE_LABELS: Record<ResolvedLine["pages"][number]["role"], string> = {
  replaced: "remplacée", part: "remesurée sans ligne qui la remplace", kept_both: "gardée (garder les deux)",
  vanished: "remesurée, ligne absente", dpgf: "ligne DPGF",
};

function outcomeText(entry: ResolvedLine) {
  switch (entry.state) {
    case "updated": {
      const shown = entry.after ?? entry.measured;
      if (shown === null) return `${quantity(entry.before)} → à décider`;
      const change = `${quantity(entry.before)} → ${quantity(shown)}`
        + (entry.before !== null && shown !== entry.before ? ` (${shown > entry.before ? "+" : ""}${quantity(shown - entry.before)})` : "");
      // A quantity changed by hand, not chosen yet: both outcomes, nothing decided.
      return entry.after === null ? `${change} avec la nouvelle mesure, ou ${quantity(entry.before)} en gardant la vôtre : à choisir` : change;
    }
    case "vanished":
      return entry.vanished === "remove" ? `${quantity(entry.before)} → retirée du devis` : entry.vanished === "keep" ? `${quantity(entry.before)}, gardée` : `${quantity(entry.before)} → à décider`;
    case "kept":
      return `${quantity(entry.before)}, gardée avec ses pages`;
    case "dpgf":
      return `${quantity(entry.before)}, sa quantité suit le rapprochement DPGF`;
  }
}

export function TakeoffPageDecisionsPanel({ proposal, error, loading, draft, strategyNotice, disabled, onDraftChange }: Readonly<{
  proposal: TakeoffPageReplacementResponse | null;
  error: string | null;
  loading: boolean;
  draft: ConfirmationDraft | null;
  strategyNotice: string | null;
  disabled: boolean;
  onDraftChange: (draft: ConfirmationDraft) => void;
}>) {
  if (error) {
    return <p role="alert" className="text-sm text-danger">{error}</p>;
  }
  if (loading && !proposal) return <p className="text-sm text-muted-foreground">Lecture des pages déjà au devis…</p>;
  if (!proposal || proposal.pages.length === 0 || !draft) return null;
  const jobs = new Map(proposal.jobs.map((job) => [job.id, job]));
  const resolution = resolveConfirmation(proposal, draft);
  const controls = new Map(confirmationControls(resolution).map((control) => [control.id, control]));
  const set = (control: ConfirmationControl | undefined, value: unknown) => {
    if (control) onDraftChange(setConfirmationControl(draft, control, value));
  };
  const titles = new Map(proposal.lines.map((line) => [line.id, line.title]));
  const vanished = resolution.lines.filter((entry) => entry.state === "vanished");
  const setAllVanished = (value: "remove" | "keep") => {
    let next = draft;
    for (const entry of vanished) {
      const control = controls.get(`vanished:${entry.line.id}`);
      if (control) next = setConfirmationControl(next, control, value);
    }
    onDraftChange(next);
  };

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

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Pages remesurées</h3>
        {resolution.pages.map(({ page, choice, label, missing }) => {
          const decision = controls.get(`page:${page.key}`);
          const reason = controls.get(`reason:${page.key}`);
          const keepBoth = decision?.options.find((option) => option.value === "keep_both");
          return (
            <fieldset key={page.key} aria-label={`Page ${label}`} className="space-y-2 rounded-lg border border-border bg-background p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">{label}</legend>
              <p className="text-sm text-foreground-secondary">Déjà au devis par {earlierLabel(page.earlier_job_ids, jobs)}, {plural(page.lines.length, "ligne")}.</p>
              <div role="radiogroup" aria-label={`Mesure de ${label}`} className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name={`takeoff-page-${page.key}`} value="replace" checked={choice.decision === "replace"} disabled={disabled}
                    onChange={() => set(decision, "replace")} />
                  Remplacer la mesure précédente (recommandé)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`takeoff-page-${page.key}`} value="keep_both" checked={choice.decision === "keep_both"}
                    disabled={disabled || Boolean(keepBoth?.disabled)} onChange={() => set(decision, "keep_both")} />
                  Garder les deux
                </label>
              </div>
              {keepBoth?.disabled ? <p className="text-xs text-muted-foreground">Garder les deux n’est pas possible : {keepBoth.disabled}.</p> : null}
              {reason && reason.kind === "reason" ? (
                <div className="space-y-2">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Motif</span>
                    <NativeSelect aria-label={`Motif pour ${label}`} value={reason.value ?? ""} disabled={disabled}
                      onChange={(event) => set(reason, event.target.value || null)}>
                      <option value="">Choisir un motif…</option>
                      {reason.options.flatMap((option) => (option.value ? [<option key={option.value} value={option.value}>{TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS[option.value]}</option>] : []))}
                    </NativeSelect>
                  </label>
                  {choice.reason === "complementary_scope" ? (
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">Ce que la mesure ajoute</span>
                      <Textarea aria-label={`Périmètre complémentaire pour ${label}`} value={choice.note} maxLength={TAKEOFF_PAGE_NOTE_MAX} disabled={disabled}
                        onChange={(event) => onDraftChange(setPageNote(draft, page.key, event.target.value))} />
                    </label>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Les deux mesures de cette page resteront au devis, et le motif sera gardé avec le métré.</p>
                </div>
              ) : null}
              {page.ambiguous_document ? (
                <p className="text-xs text-muted-foreground">Deux plans de même nom sont au devis sur cette page : une ligne qui ne connaît que le nom de son plan n’en remplace aucune.</p>
              ) : null}
              {missing.length > 0 ? <p role="status" className="text-xs font-medium text-warning">{missing.join(" ")}</p> : null}
            </fieldset>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Lignes du devis sur ces pages</h3>
        <ul aria-label="Lignes du devis sur ces pages" className="space-y-2 text-sm">
          {resolution.lines.map((entry) => {
            const take = controls.get(`take:${entry.line.id}`);
            const removal = controls.get(`vanished:${entry.line.id}`);
            const removeOption = removal?.options.find((option) => option.value === "remove");
            return (
              <li key={entry.line.id} aria-label={entry.line.title} className="space-y-1 rounded-md border border-border bg-background p-2">
                <div>
                  <span className="font-medium">{entry.line.title}</span> : {outcomeText(entry)}
                  {entry.state === "updated" ? <span className="text-muted-foreground"> — titre, prix et catégorie gardés</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.pages.map((page) => `${page.label} : ${ROLE_LABELS[page.role]}`).join(" · ")}
                  {entry.newLineIds.length > 0 ? ` · remplacée par ${plural(entry.newLineIds.length, "ligne")} du nouveau métré` : ""}
                </p>
                {take && take.kind === "take" ? (
                  <div role="radiogroup" aria-label={`Quantité de ${entry.line.title}`} className="flex flex-wrap gap-4 pl-2 text-xs">
                    <span className="text-foreground-secondary">Quantité modifiée à la main :</span>
                    <label className="flex items-center gap-1">
                      <input type="radio" name={`take-${entry.line.id}`} checked={take.value === "new"} disabled={disabled} onChange={() => set(take, "new")} />
                      Prendre la nouvelle mesure
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name={`take-${entry.line.id}`} checked={take.value === "keep_mine"} disabled={disabled} onChange={() => set(take, "keep_mine")} />
                      Garder ma quantité ({quantity(entry.before)})
                    </label>
                  </div>
                ) : null}
                {entry.pages.filter((page) => page.role === "part").map((page) => {
                  const part = controls.get(`part:${entry.line.id}:${page.key}`);
                  return part ? (
                    <label key={page.key} className="flex flex-wrap items-center gap-2 pl-2 text-xs">
                      <span>Sa part de {page.label}, que le nouveau métré n’a plus :</span>
                      <NativeSelect aria-label={`Part de ${page.label} pour ${entry.line.title}`} wrapperClassName="w-auto" size="sm"
                        value={part.value ?? ""} disabled={disabled} onChange={(event) => set(part, event.target.value || null)}>
                        <option value="" disabled>Choisir…</option>
                        <option value="drop">La retirer</option>
                        <option value="keep">La garder</option>
                      </NativeSelect>
                    </label>
                  ) : null;
                })}
                {removal && removal.kind === "vanished" ? (
                  <div className="flex flex-wrap items-center gap-2 pl-2 text-xs">
                    <span>Le nouveau métré n’a plus cette ligne :</span>
                    <NativeSelect aria-label={`Choix pour ${entry.line.title}`} wrapperClassName="w-auto" size="sm" value={removal.value ?? ""} disabled={disabled}
                      onChange={(event) => set(removal, event.target.value || null)}>
                      <option value="" disabled>Choisir…</option>
                      <option value="remove" disabled={Boolean(removeOption?.disabled)}>Retirer du devis</option>
                      <option value="keep">Garder</option>
                    </NativeSelect>
                    {removeOption?.disabled ? <span className="text-muted-foreground">Retirer n’est pas possible : {removeOption.disabled}.</span> : null}
                  </div>
                ) : null}
                {entry.missing.length > 0 ? <p role="status" className="text-xs font-medium text-warning">{entry.missing.join(" ")}</p> : null}
              </li>
            );
          })}
        </ul>
        {vanished.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setAllVanished("remove")}>
              Retirer les {plural(vanished.length, "ligne")} absentes (quand c’est possible)
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setAllVanished("keep")}>
              Garder les {plural(vanished.length, "ligne")} absentes
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Lignes du nouveau métré</h3>
        <ul aria-label="Lignes du nouveau métré" className="space-y-1 text-sm">
          {resolution.newLines.map((entry) => {
            const pair = controls.get(`pair:${entry.newLine.id}`);
            const pages = entry.pageKeys.map((key) => resolution.pages.find((page) => page.page.key === key)!.label);
            return (
              <li key={entry.newLine.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {entry.newLine.designation} — {quantity(entry.newLine.quantity)} {entry.newLine.unit}
                  <span className="text-xs text-muted-foreground"> ({pages.join(", ")})</span>
                </span>
                {pair && pair.kind === "pair" ? (
                  <NativeSelect aria-label={`Remplace, pour ${entry.newLine.designation}`} wrapperClassName="w-auto" size="sm"
                    value={pair.value ?? ""} disabled={disabled || Boolean(pair.disabled)} onChange={(event) => set(pair, event.target.value || null)}>
                    <option value="">Ajouter une ligne</option>
                    {pair.options.flatMap((option) => (option.value ? [<option key={option.value} value={option.value} disabled={Boolean(option.disabled)}>Remplace « {titles.get(option.value)} »</option>] : []))}
                  </NativeSelect>
                ) : null}
                {pair && pair.kind === "pair" && pair.disabled ? <span className="w-full text-xs text-muted-foreground">{pair.disabled === "aucune ligne précédente de même unité sur ses pages remplacées" ? "Ajoutée : aucune ligne précédente de même unité sur ses pages remplacées." : `Rattachement ${pair.disabled}.`}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
      {proposal.unidentified_count > 0 ? (
        <p className="text-xs text-muted-foreground">{plural(proposal.unidentified_count, "ligne")} de ce métré sans plan ni page : non comparée{proposal.unidentified_count > 1 ? "s" : ""}.</p>
      ) : null}
    </section>
  );
}
