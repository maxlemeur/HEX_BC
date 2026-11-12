"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCheck, Link2, Plus } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MaterialRequestBlockedLine } from "@/lib/material-requests/client";
import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";

import { lineTitle, plural } from "./format";
import { MaterialRequestArticleSheet } from "./MaterialRequestArticleSheet";
import { MaterialRequestBulkBar } from "./MaterialRequestBulkBar";
import { LINE_COLUMNS, LINE_TABLE_COLUMN_COUNT, MaterialRequestLineRow } from "./MaterialRequestLineRow";
import type {
  ArticleLinkEntry,
  BulkLinkResult,
  MaterialRequestEditorApi,
  SaveResult,
  WithheldLines,
} from "./useMaterialRequestEditor";

const COLUMN_TITLES: Partial<Record<(typeof LINE_COLUMNS)[number]["key"], string>> = {
  position: "Numéro de ligne",
  quantity: "Quantité",
};

/** Which lines the server held back, and why, in the words of the shared alert rules. */
function BlockedReport({
  blocked,
  editor,
}: Readonly<{ blocked: MaterialRequestBlockedLine[]; editor: MaterialRequestEditorApi }>) {
  const linesById = new Map(editor.data.lines.map((line) => [line.id, line]));
  return (
    <Alert variant="warning" role="alert">
      <AlertTitle>
        Rien n’a été validé : {plural(blocked.length, "ligne est", "lignes sont")} à régler d’abord.
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {blocked.map((entry) => {
            const line = linesById.get(entry.id);
            if (!line) return <li key={entry.id}>Une ligne qui n’est plus affichée : rechargez la page.</li>;
            const messages = (editor.alertsByLine.get(entry.id) ?? [])
              .filter((alert) => entry.codes.includes(alert.code))
              .map((alert) => alert.message);
            return (
              <li key={entry.id}>
                <span className="font-semibold">Ligne {line.position}</span> ({lineTitle(line)}) :{" "}
                {messages.length > 0 ? messages.join(" ") : "à vérifier sur la ligne."}
              </li>
            );
          })}
        </ul>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={editor.dismissBlocked}>
          Fermer
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Which lines an action left out because a change typed on them is not saved, in one sentence. */
function WithheldNotice({
  withheld,
  editor,
}: Readonly<{ withheld: WithheldLines; editor: MaterialRequestEditorApi }>) {
  const positions = editor.data.lines
    .filter((line) => withheld.lineIds.includes(line.id))
    .map((line) => String(line.position));
  if (positions.length === 0) return null;
  const several = positions.length > 1;
  const named = several
    ? `Les lignes ${positions.slice(0, -1).join(", ")} et ${positions[positions.length - 1]}`
    : `La ligne ${positions[0]}`;
  const sentence =
    withheld.action === "validate"
      ? several
        ? `${named} n’ont pas été validées : leur dernière modification n’a pas été enregistrée.`
        : `${named} n’a pas été validée : sa dernière modification n’a pas été enregistrée.`
      : several
        ? `${named} n’ont pas été modifiées : une valeur saisie dans cette colonne n’y est pas enregistrée.`
        : `${named} n’a pas été modifiée : une valeur saisie dans cette colonne n’y est pas enregistrée.`;
  return (
    <Alert variant="warning">
      <AlertDescription>
        <p>{sentence}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={editor.dismissWithheld}>
          Compris
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** What the bulk link did, in one or two sentences. */
function bulkLinkReport(result: BulkLinkResult): string[] {
  const left =
    result.left === 0
      ? "toutes les lignes ont un article."
      : `${result.left} ${result.left > 1 ? "restent" : "reste"} sans article, à choisir une par une.`;
  const sentences = [`${plural(result.linked, "ligne rattachée", "lignes rattachées")} · ${left}`];
  if (result.failures.length > 0) {
    sentences.push(
      `${plural(result.failures.length, "ligne n’a", "lignes n’ont")} pas pu être rattachée${result.failures.length > 1 ? "s" : ""} : ${[...new Set(result.failures)].join(" ")}`,
    );
  }
  return sentences;
}

export function MaterialRequestLines({
  editor,
  materialListId,
  headingId,
  toolbar,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  materialListId: string;
  headingId: string;
  /** Read-only actions shown beside the validation button (message, previous requests). */
  toolbar?: React.ReactNode;
}>) {
  const toast = useToast();
  const unitListId = useId();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkReport, setLinkReport] = useState<string[] | null>(null);
  const [articleLineId, setArticleLineId] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const focusAddedLine = useRef(false);
  const { data, canWrite, alertsByLine } = editor;
  const lines = data.lines;

  // A line added by hand is typed at once: the cursor goes to its quantity.
  useEffect(() => {
    if (!focusAddedLine.current) return;
    focusAddedLine.current = false;
    const quantities = section.current?.querySelectorAll<HTMLInputElement>('input[aria-label^="Quantité, ligne"]');
    quantities?.[quantities.length - 1]?.focus();
  }, [lines.length]);

  const drafts = useMemo(() => lines.filter((line) => line.status === "draft"), [lines]);
  // A line that left the drafts (validated, removed) leaves the selection for good: reopened later, it
  // comes back unchecked instead of silently rejoining the next bulk action.
  const draftIds = useMemo(() => new Set(drafts.map((line) => line.id)), [drafts]);
  if ([...selection].some((id) => !draftIds.has(id))) {
    setSelection(new Set([...selection].filter((id) => draftIds.has(id))));
  }
  const selectedIds = useMemo(
    () => drafts.filter((line) => selection.has(line.id)).map((line) => line.id),
    [drafts, selection],
  );
  // One gesture validates only the lines that carry no alert at all. A remark that does not block (a
  // material that differs from the request's) still asks for a look: such a line is validated by its
  // own button.
  // A line whose last change is not saved (on its way, or refused) is left out as well: what would be
  // validated is not what its row shows.
  const lineChanges = editor.lineChanges;
  const clearIds = useMemo(
    () =>
      drafts
        .filter((line) => (alertsByLine.get(line.id) ?? []).length === 0 && !lineChanges.has(line.id))
        .map((line) => line.id),
    [alertsByLine, drafts, lineChanges],
  );
  const validatedCount = lines.length - drafts.length;
  const heldCount = drafts.filter((line) => (alertsByLine.get(line.id) ?? []).some((alert) => alert.blocking)).length;
  const remarkCount = drafts.filter((line) => {
    const alerts = alertsByLine.get(line.id) ?? [];
    return alerts.length > 0 && !alerts.some((alert) => alert.blocking);
  }).length;
  const allSelected = drafts.length > 0 && selectedIds.length === drafts.length;
  // One gesture links only what the technician named without doubt: a reference written on the sheet or
  // a usual name the office taught, with no warning at all. A validated line is left alone (the link
  // would return it to draft), and so is a line holding a change that is not saved.
  const { proposalsOf } = editor;
  const sureLinks = useMemo<ArticleLinkEntry[]>(
    () =>
      canWrite
        ? drafts.flatMap((line) => {
            if (line.product_id || lineChanges.has(line.id)) return [];
            const proposals = proposalsOf(line.id);
            const first = proposals.status === "ready" ? proposals.candidates[0] : undefined;
            if (!first || first.warnings.length > 0 || (first.via !== "reference" && first.via !== "alias")) return [];
            return [{ lineId: line.id, input: { product_id: first.article.id, via: first.via } }];
          })
        : [],
    [canWrite, drafts, lineChanges, proposalsOf],
  );
  const articleLine = articleLineId ? (lines.find((line) => line.id === articleLineId) ?? null) : null;

  const report = (result: SaveResult) => {
    setError(result.ok || result.blocked ? null : result.message);
    return result.ok;
  };
  const guarded = async (action: () => Promise<SaveResult>) => {
    setBusy(true);
    const ok = report(await action());
    setBusy(false);
    return ok;
  };
  const validate = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    const result = await editor.validateLines(ids);
    setBusy(false);
    report(result);
    if (result.ok && result.validated) {
      toast.success({ title: plural(result.validated, "ligne validée", "lignes validées") });
    }
  };
  const linkSure = async () => {
    if (sureLinks.length === 0) return;
    setBusy(true);
    setLinkReport(null);
    const result = await editor.linkArticles(sureLinks);
    setBusy(false);
    setLinkReport(bulkLinkReport(result));
  };
  const addLine = async () => {
    focusAddedLine.current = true;
    if (!(await guarded(() => editor.addLines([{}])))) focusAddedLine.current = false;
  };
  const toggle = (line: MaterialRequestLine, selected: boolean) =>
    setSelection((current) => {
      const next = new Set(current);
      if (selected) next.add(line.id);
      else next.delete(line.id);
      return next;
    });

  return (
    <section ref={section} aria-labelledby={headingId} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="typo-h3 text-foreground">
            Lignes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {lines.length === 0
              ? "Aucune ligne pour le moment."
              : [
                  plural(lines.length, "ligne", "lignes"),
                  plural(validatedCount, "validée", "validées"),
                  heldCount > 0 ? `${heldCount} à régler avant validation` : null,
                  remarkCount > 0 ? `${remarkCount} avec une remarque, à valider une par une` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {canWrite ? (
            <Button
              type="button"
              variant="primary"
              className="h-auto min-h-9 max-w-full whitespace-normal py-1.5"
              disabled={clearIds.length === 0 || busy}
              onClick={() => void validate(clearIds)}
            >
              <CheckCheck aria-hidden="true" />
              Valider les lignes sans alerte ({clearIds.length})
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-9 max-w-full whitespace-normal py-1.5"
              disabled={sureLinks.length === 0 || busy}
              onClick={() => void linkSure()}
            >
              <Link2 aria-hidden="true" />
              Rattacher les références et noms connus ({sureLinks.length})
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {linkReport ? (
        <div role="status" className="space-y-0.5 text-sm text-foreground">
          {linkReport.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
      ) : null}
      {editor.blocked ? <BlockedReport blocked={editor.blocked} editor={editor} /> : null}
      {editor.withheld ? <WithheldNotice withheld={editor.withheld} editor={editor} /> : null}
      {editor.reopenedByRequestChange ? (
        <Alert variant="warning">
          <AlertDescription>
            <p>
              {editor.reopenedByRequestChange > 1
                ? `${editor.reopenedByRequestChange} lignes validées sont repassées en brouillon : elles comptaient sur la matière présumée de la demande, qui vient de changer.`
                : "1 ligne validée est repassée en brouillon : elle comptait sur la matière présumée de la demande, qui vient de changer."}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={editor.dismissReopened}>
              Compris
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite && drafts.length > 0 ? (
        <MaterialRequestBulkBar
          selectedCount={selectedIds.length}
          busy={busy}
          materialListId={materialListId}
          unitListId={unitListId}
          onApply={(patch) => guarded(() => editor.applyToLines(selectedIds, patch))}
          onValidate={() => void validate(selectedIds)}
          onClear={() => setSelection(new Set())}
        />
      ) : null}

      <datalist id={unitListId}>
        {MEASUREMENT_UNITS.filter((unit) => unit.active && unit.dimension !== "inch").map((unit) => (
          <option key={unit.code} value={unit.code} label={unit.label} />
        ))}
      </datalist>

      {lines.length > 0 ? (
        <div
          role="region"
          aria-label="Tableau des lignes"
          tabIndex={0}
          // `relative`: the visually hidden labels and the select chevrons inside are absolutely positioned;
          // without a positioned scroll container they widen the page itself instead of scrolling here.
          className="relative overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <table className="w-full min-w-[1800px] border-collapse text-left">
            <caption className="sr-only">
              Lignes de la demande. Les cases en jaune sont à compléter ou à vérifier avant validation.
            </caption>
            <thead className="border-b border-border bg-surface-subtle text-xs font-semibold text-muted-foreground">
              <tr>
                <th scope="col" className="w-9 px-2 py-2">
                  {canWrite && drafts.length > 0 ? (
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label="Tout sélectionner"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelection(event.currentTarget.checked ? new Set(drafts.map((line) => line.id)) : new Set())
                      }
                    />
                  ) : (
                    <span className="sr-only">Sélection</span>
                  )}
                </th>
                {LINE_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" className={`px-2 py-2 ${column.width}`}>
                    {COLUMN_TITLES[column.key] ? (
                      <abbr title={COLUMN_TITLES[column.key]} className="no-underline">
                        {column.label}
                      </abbr>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                <th scope="col" className="min-w-40 px-2 py-2">
                  État
                </th>
              </tr>
            </thead>
            {lines.map((line) => (
              <MaterialRequestLineRow
                key={line.id}
                line={line}
                alerts={alertsByLine.get(line.id) ?? []}
                request={data.request}
                supplierOptions={data.supplierOptions}
                canWrite={canWrite}
                selected={selection.has(line.id)}
                onSelectedChange={(selected) => toggle(line, selected)}
                change={lineChanges.get(line.id)}
                onSave={(patch) => editor.saveLine(line.id, patch)}
                onForget={(fields) => editor.forgetLineFailure(line.id, fields)}
                onDelete={() => editor.removeLine(line.id)}
                onValidate={() => editor.validateLines([line.id])}
                onReopen={() => editor.reopenLines([line.id])}
                materialListId={materialListId}
                unitListId={unitListId}
                article={line.product_id ? (editor.articles[line.product_id] ?? null) : null}
                proposals={proposalsOf(line.id)}
                articleNotice={editor.articleNotices.get(line.id)}
                articleConflict={editor.articleConflicts.get(line.id)}
                onLinkArticle={(candidate) =>
                  editor.linkArticle(line.id, { product_id: candidate.article.id, via: candidate.via })
                }
                onUnlinkArticle={() => editor.unlinkArticle(line.id)}
                onOpenArticles={() => setArticleLineId(line.id)}
                onRetryProposals={editor.retryProposals}
              />
            ))}
            {canWrite ? (
              <tfoot>
                <tr>
                  <td colSpan={LINE_TABLE_COLUMN_COUNT} className="px-2 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void addLine()}
                    >
                      <Plus aria-hidden="true" />
                      Ajouter une ligne
                    </Button>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : canWrite ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Recopiez la demande ligne par ligne, à partir de l’original.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void addLine()}
          >
            <Plus aria-hidden="true" />
            Ajouter une ligne
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <MaterialRequestArticleSheet
          editor={editor}
          line={articleLine}
          onOpenChange={(open) => {
            if (!open) setArticleLineId(null);
          }}
        />
      ) : null}
    </section>
  );
}
