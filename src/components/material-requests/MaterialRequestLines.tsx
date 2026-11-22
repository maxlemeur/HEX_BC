"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCheck, Link2, Plus, Truck } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { SupplyTypeSuppliersDialog } from "@/components/products/SupplyTypeSuppliersDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MaterialRequestLineAlert } from "@/lib/material-requests/alerts";
import type { MaterialRequestBlockedLine, MaterialRequestOrderLink } from "@/lib/material-requests/client";
import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";
import { cn } from "@/lib/utils";

import { linesSubject, lineTitle } from "./format";
import { MaterialRequestArticleSheet } from "./MaterialRequestArticleSheet";
import { MaterialRequestBulkBar } from "./MaterialRequestBulkBar";
import { LINE_COLUMNS, LINE_GRID, MaterialRequestLineRow, type LineColumn } from "./MaterialRequestLineRow";
import { MaterialRequestLineSummary } from "./MaterialRequestLineWorkbench";
import type {
  ArticleLinkEntry,
  BulkLinkResult,
  BulkRetainResult,
  MaterialRequestEditorApi,
  SaveResult,
  SupplierRetainEntry,
  WithheldLines,
} from "./useMaterialRequestEditor";
import { plural } from "@/lib/text/plural";

/** Which lines the server held back, and why, in the words of the shared alert rules. */
function BlockedReport({
  blocked,
  editor,
}: Readonly<{ blocked: MaterialRequestBlockedLine[]; editor: MaterialRequestEditorApi }>) {
  const { linesById } = editor;
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
                <span className="font-semibold">{lineTitle(line)}</span> :{" "}
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
  // The lines are named by what they ask, as the sheet shows them: a number would point at nothing on screen.
  const names = editor.data.lines.filter((line) => withheld.lineIds.includes(line.id)).map((line) => lineTitle(line));
  if (names.length === 0) return null;
  const several = names.length > 1;
  const named = linesSubject(names);
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

/** What the bulk retain did, in one to three sentences. */
function bulkRetainReport(result: BulkRetainResult): string[] {
  const sentences = result.retained > 0 ? [`${plural(result.retained, "fournisseur retenu", "fournisseurs retenus")}.`] : [];
  if (result.skipped > 0) {
    sentences.push(
      result.skipped > 1
        ? `${result.skipped} lignes avaient déjà un fournisseur : non modifiées.`
        : "1 ligne avait déjà un fournisseur : non modifiée.",
    );
  }
  const failed = result.failures.reduce((total, failure) => total + failure.count, 0);
  if (failed > 0) {
    const lead = failed > 1 ? `${failed} lignes n’ont pas reçu leur fournisseur` : "1 ligne n’a pas reçu son fournisseur";
    sentences.push(`${lead} : ${[...new Set(result.failures.map((failure) => failure.message))].join(" ")}`);
  }
  return sentences;
}

/**
 * Why « Rattacher les références et noms connus » has nothing to do, in the office's words; null while it has, or
 * while the proposals are still read.
 */
function linkHint(
  drafts: readonly MaterialRequestLine[],
  proposalsOf: MaterialRequestEditorApi["proposalsOf"],
): string | null {
  const unlinked = drafts.filter((line) => !line.product_id);
  if (drafts.length === 0) return "Rien à rattacher d’un coup : aucune ligne n’est en brouillon.";
  if (unlinked.length === 0) return "Rien à rattacher d’un coup : toutes les lignes en brouillon ont un article.";
  if (unlinked.some((line) => proposalsOf(line.id).status !== "ready")) return null;
  return "Rien à rattacher d’un coup : aucune ligne ne porte une référence ou un nom usuel connus, sans réserve. Rattachez les articles ligne par ligne (« Rattacher », « Chercher ou créer ») ; un nom usuel mémorisé au rattachement sera reconnu ensuite.";
}

/**
 * Why « Retenir les fournisseurs proposés » has nothing to do; null while it has, or while the proposals are read.
 * `missing` counts the linked lines without a supplier that no source proposes one for.
 */
function supplierHint(lines: readonly MaterialRequestLine[], read: (lineId: string) => boolean): { text: string; missing: number } | null {
  const linked = lines.filter((line) => line.product_id);
  const without = linked.filter((line) => !line.supplier_id);
  if (linked.length === 0) {
    return { text: "Aucun fournisseur à retenir : un fournisseur se propose une fois l’article de la ligne rattaché.", missing: 0 };
  }
  if (without.length === 0) return { text: "Aucun fournisseur à retenir : toutes les lignes rattachées en ont un.", missing: 0 };
  if (!without.every((line) => read(line.id))) return null;
  return {
    text: `Aucun fournisseur à retenir : rien n’en propose pour ${without.length > 1 ? `les ${without.length} lignes rattachées` : "la ligne rattachée"} sans fournisseur. Donnez un fournisseur privilégié au type de fourniture de l’article, ou choisissez-le sur la ligne.`,
    missing: without.length,
  };
}

/** The column of the sheet that carries each field an alert names. */
const ALERT_COLUMN: Record<NonNullable<MaterialRequestLineAlert["field"]>, LineColumn> = {
  quantity: "quantity",
  unit: "unit",
  product_type: "type",
  dimension: "dimension",
  material: "material",
};

/**
 * Where an alert of a draft line is settled, inside its row: the cell of the field it names, the choice of its
 * hint, or a gesture read once the line is unfolded (`unfold`). Without a place of its own (`selector` null), the
 * words of the alert are read under the unfolded row.
 */
function lineAlertTarget(alert: MaterialRequestLineAlert): { selector: string | null; unfold: boolean } {
  if (alert.code === "quantity_doubtful") return { selector: '[data-line-field="quantity"] input[type="checkbox"]', unfold: false };
  if (alert.field) return { selector: `[data-line-field="${ALERT_COLUMN[alert.field]}"] input:not([type="checkbox"])`, unfold: false };
  return { selector: `[data-line-alert="${alert.code}"]`, unfold: true };
}

export function MaterialRequestLines({
  editor,
  materialListId,
  headingId,
  orderedLine,
  orderStatusKnown,
  onReviewPresumedMaterial,
  toolbar,
  canEditCatalogue = false,
  canCreateSupplyType = false,
  nextAction,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  materialListId: string;
  headingId: string;
  /** The purchase order each ordered line went into (TI-691, delivery 3a). */
  orderedLine?: (lineId: string) => MaterialRequestOrderLink | null;
  orderStatusKnown: boolean;
  onReviewPresumedMaterial: () => void;
  /** Actions shown beside the lines (original, message, previous requests). */
  toolbar?: ReactNode;
  /** May set a supply type's preferred supplier here (admins and engineers): the gap is filled in place. */
  canEditCatalogue?: boolean;
  /** May add a supply type while creating the article a line names (admins only). */
  canCreateSupplyType?: boolean;
  nextAction?: ReactNode;
}>) {
  const toast = useToast();
  const unitListId = useId();
  const [typeSuppliersOpen, setTypeSuppliersOpen] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkReport, setLinkReport] = useState<string[] | null>(null);
  const [inspectedLineId, setInspectedLineId] = useState<string | null>(null);
  // The draft lines the office unfolded or folded itself; the others show what they hold (`MaterialRequestLineRow`).
  const [unfolded, setUnfolded] = useState<ReadonlyMap<string, boolean>>(new Map());
  /** The alert the count over the sheet leads to, until its line is drawn unfolded. */
  const alertToFocus = useRef<{ lineId: string; selector: string | null } | null>(null);
  const [articleLineId, setArticleLineId] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const focusQuantity = useRef<{ position: number } | { afterCount: number } | null>(null);
  const { data, canWrite, alertsByLine } = editor;
  const lines = data.lines;

  // Once an added or reopened line is editable, put the cursor in its quantity.
  useEffect(() => {
    const target = focusQuantity.current;
    if (!target || ("afterCount" in target && lines.length <= target.afterCount)) return;
    const quantities = section.current?.querySelectorAll<HTMLInputElement>('input[aria-label^="Quantité, ligne"]');
    const input = "position" in target
      ? section.current?.querySelector<HTMLInputElement>(`input[aria-label="Quantité, ligne ${target.position}"]`)
      : quantities?.[quantities.length - 1];
    if (!input) return;
    focusQuantity.current = null;
    input.focus();
  }, [lines]);

  // Once a line is unfolded for an alert, the cursor goes to what settles it, or to the row that now says it.
  useEffect(() => {
    const target = alertToFocus.current;
    if (!target) return;
    alertToFocus.current = null;
    const row = document.getElementById(`material-request-line-${target.lineId}`);
    ((target.selector ? row?.querySelector<HTMLElement>(target.selector) : null) ?? row)?.focus();
  }, [unfolded]);

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
  const heldLines = drafts.filter((line) => (alertsByLine.get(line.id) ?? []).some((alert) => alert.blocking));
  const attentionLine = heldLines[0] ?? (clearIds.length === 0
    ? drafts.find((line) => (alertsByLine.get(line.id) ?? []).length > 0)
    : undefined);
  const remarkCount = drafts.filter((line) => (alertsByLine.get(line.id) ?? []).length > 0).length - heldLines.length;
  const alertsToReview = attentionLine ? alertsByLine.get(attentionLine.id) : undefined;
  const attentionAlert = alertsToReview?.find((alert) => alert.blocking) ?? alertsToReview?.[0];
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
  // Every line with a proposal and no supplier, validated ones included: choosing a supplier keeps a
  // validated line validated.
  const { supplierProposalOf } = editor;
  const proposedSuppliers = useMemo<SupplierRetainEntry[]>(
    () =>
      canWrite
        ? lines.flatMap((line) => {
            const proposal = line.supplier_id ? null : supplierProposalOf(line.id);
            return proposal ? [{ lineId: line.id, supplierId: proposal.supplier_id }] : [];
          })
        : [],
    [canWrite, lines, supplierProposalOf],
  );
  const articleLine = articleLineId ? (lines.find((line) => line.id === articleLineId) ?? null) : null;
  // A button at zero says why, and what to do, instead of staying grey without a word (the owner's walk, 2026-11-14).
  const linkNothing = canWrite && lines.length > 0 && sureLinks.length === 0 ? linkHint(drafts, proposalsOf) : null;
  const supplierNothing =
    canWrite && lines.length > 0 && proposedSuppliers.length === 0 && editor.supplierProposalsStatus === "ready"
      ? supplierHint(lines, editor.supplierReferenceKnown)
      : null;
  const chooseTypeSupplier = canWrite && canEditCatalogue ? () => setTypeSuppliersOpen(true) : null;

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
  const retainProposed = async () => {
    if (proposedSuppliers.length === 0) return;
    setBusy(true);
    setLinkReport(null);
    const result = await editor.retainSuppliers(proposedSuppliers);
    setBusy(false);
    setLinkReport(bulkRetainReport(result));
  };
  const addLine = async () => {
    const target = { afterCount: lines.length };
    focusQuantity.current = target;
    if (!(await guarded(() => editor.addLines([{}]))) && focusQuantity.current === target) {
      focusQuantity.current = null;
    }
  };
  const reopenLine = async (line: MaterialRequestLine) => {
    const target = { position: line.position };
    focusQuantity.current = target;
    const result = await editor.reopenLines([line.id]);
    if (!result.ok && focusQuantity.current === target) focusQuantity.current = null;
    return result;
  };
  const setLineUnfolded = (lineId: string, open: boolean) => setUnfolded((current) => new Map(current).set(lineId, open));
  const focusLineAlert = (line: MaterialRequestLine, alert: MaterialRequestLineAlert) => {
    const { selector, unfold } = lineAlertTarget(alert);
    alertToFocus.current = { lineId: line.id, selector };
    // A new map either way: the cursor moves once the sheet is drawn again.
    setUnfolded((current) => (unfold ? new Map(current).set(line.id, true) : new Map(current)));
  };
  const toggle = (line: MaterialRequestLine, selected: boolean) =>
    setSelection((current) => {
      const next = new Set(current);
      if (selected) next.add(line.id);
      else next.delete(line.id);
      return next;
    });

  /** The sheet's corner holds « Tout sélectionner » while there are drafts to select. */
  const selectAll = canWrite && drafts.length > 0;
  // The details of a validated line open under its row, on request, and its title closes them again: the sheet is
  // the same whether lines are still edited or all settled.
  const inspect = (line: MaterialRequestLine) => setInspectedLineId((current) => (current === line.id ? null : line.id));
  const renderLine = (line: MaterialRequestLine) => {
    const Component = line.status === "validated" || !canWrite ? MaterialRequestLineSummary : MaterialRequestLineRow;
    return (
      <Component
        key={line.id}
        line={line}
        inspected={inspectedLineId === line.id}
        onInspect={() => inspect(line)}
        alerts={alertsByLine.get(line.id) ?? []}
        request={data.request}
        supplierOptions={data.supplierOptions}
        canWrite={canWrite}
        selected={selection.has(line.id)}
        onSelectedChange={(selected) => toggle(line, selected)}
        unfolded={unfolded.get(line.id) ?? null}
        onUnfoldedChange={(open) => setLineUnfolded(line.id, open)}
        change={lineChanges.get(line.id)}
        onSave={(patch) => editor.saveLine(line.id, patch)}
        onForget={(fields) => editor.forgetLineFailure(line.id, fields)}
        onDelete={() => editor.removeLine(line.id)}
        onValidate={() => editor.validateLines([line.id])}
        onReopen={() => reopenLine(line)}
        materialListId={materialListId}
        unitListId={unitListId}
        article={line.product_id ? (editor.articles[line.product_id] ?? null) : null}
        proposals={proposalsOf(line.id)}
        articleNotice={editor.articleNotices.get(line.id)}
        articleConflict={editor.articleConflicts.get(line.id)}
        onLinkArticle={(candidate, learnAlias) =>
          editor.linkArticle(line.id, {
            product_id: candidate.article.id,
            via: candidate.via,
            ...(learnAlias ? { learn_alias: true } : {}),
          })
        }
        onUnlinkArticle={() => editor.unlinkArticle(line.id)}
        onOpenArticles={() => setArticleLineId(line.id)}
        onRetryProposals={editor.retryProposals}
        supplierProposal={line.supplier_id ? null : supplierProposalOf(line.id)}
        supplierReference={line.supplier_id ? editor.supplierReferenceOf(line.id) : null}
        supplierProposalRead={editor.supplierReferenceKnown(line.id)}
        onChooseTypeSupplier={chooseTypeSupplier}
        canEditCatalogue={canEditCatalogue}
        onRetainSupplier={(supplierId) => editor.retainSupplier(line.id, supplierId)}
        ordered={orderedLine?.(line.id) ?? null}
        orderStatusKnown={orderStatusKnown}
      />
    );
  };


  return (
    <section ref={section} aria-labelledby={headingId} className="min-w-0">
      <div className="mr-workbench min-w-0 py-5">
      <div className="min-w-0 space-y-4">
      {/*
        One line says where the lines stand, and its last words lead to the first value to fix: what there is to fix
        is said by the tint of its cell, not by a banner above the sheet.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={headingId} className="typo-h3 text-foreground">Lignes</h2>
          {lines.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span>{`${plural(lines.length, "ligne", "lignes")} · ${plural(validatedCount, "validée", "validées")}`}</span>
              {canWrite && attentionLine && attentionAlert ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-sm font-semibold text-warning underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
                    title={attentionAlert.message}
                    onClick={() => {
                      if (attentionAlert.code === "material_unconfirmed") onReviewPresumedMaterial();
                      else focusLineAlert(attentionLine, attentionAlert);
                    }}
                  >
                    {heldLines.length > 0 ? `${heldLines.length} à compléter` : plural(remarkCount, "remarque à vérifier", "remarques à vérifier")}
                  </button>
                </>
              ) : canWrite && drafts.length > 0 && clearIds.length === 0 ? (
                <span title="Enregistrez les corrections pour pouvoir valider."> · corrections en cours</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {canWrite ? (
            <Button type="button" variant={lines.length === 0 ? "primary" : "outline"} size="sm" disabled={busy} onClick={() => void addLine()}>
              <Plus aria-hidden="true" />
              Ajouter une ligne
            </Button>
          ) : null}
          {canWrite && drafts.length > 0 ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="whitespace-normal"
              disabled={clearIds.length === 0 || busy}
              onClick={() => void validate(clearIds)}
            >
              <CheckCheck aria-hidden="true" />
              Valider les lignes sans alerte ({clearIds.length})
            </Button>
          ) : null}
        </div>
      </div>
      {canWrite && editor.supplierProposalsStatus === "error" ? (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <p>Fournisseurs proposés indisponibles.</p>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0"
            aria-label="Recharger les fournisseurs proposés"
            onClick={editor.retrySupplierProposals}
          >
            Réessayer
          </Button>
        </div>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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

      <datalist id={unitListId}>
        {MEASUREMENT_UNITS.filter((unit) => unit.active && unit.dimension !== "inch").map((unit) => (
          <option key={unit.code} value={unit.code} label={unit.label} />
        ))}
      </datalist>

      {canWrite && drafts.length > 0 ? (
        // The form is shown once a line is checked: until then it could do nothing. It stays mounted, so that the
        // field chosen and the value typed survive a line unchecked then checked again.
        <div hidden={selectedIds.length === 0}>
          <MaterialRequestBulkBar
            selectedCount={selectedIds.length}
            busy={busy}
            materialListId={materialListId}
            unitListId={unitListId}
            onApply={(patch) => guarded(() => editor.applyToLines(selectedIds, patch))}
            onValidate={() => void validate(selectedIds)}
            onClear={() => setSelection(new Set())}
          />
        </div>
      ) : null}

      {lines.length > 0 ? (
        <>
          {/* A sheet of cells on the whole width from 1080 px, cards below it: see `MaterialRequestLineRow`. */}
          <div className="sheet:rounded-lg sheet:border sheet:border-border sheet:bg-surface">
            {/*
              The column titles only repeat, for the eye, the name each field already carries: they stay hidden from
              assistive technologies. « Tout sélectionner » sits in the corner cell, over the lines' own checkboxes, as
              in a spreadsheet; below the sheet's width the header is that one row, as it reads in a card list.
            */}
            <div
              className={cn(
                // Sizes come from classes the page enlarges (`material-request-workbench.css`), not from variants.
                "text-xs",
                // Below the sheet's width the header is the row of what acts on every line: nothing to show without it.
                selectAll || sureLinks.length > 0 || proposedSuppliers.length > 0 ? "flex flex-wrap items-center gap-x-1.5 gap-y-1" : "hidden",
                "sheet:items-stretch sheet:gap-0 sheet:rounded-t-lg sheet:border-b sheet:border-border sheet:bg-surface-subtle sheet:font-medium sheet:text-muted-foreground max-sheet:mb-3",
                // Stuck under the application's top bar (60 px, itself stuck at the top of the window).
                "sheet:sticky sheet:top-[60px] sheet:z-10",
                LINE_GRID,
              )}
            >
              {selectAll ? (
                <>
                  {/* In the sheet the box sits over the lines' boxes. */}
                  <div className="flex items-center gap-2 sheet:justify-center sheet:border-r sheet:border-border">
                    {/* The label is the checkbox's whole name: what follows it describes it. */}
                    <label className="flex w-fit items-center gap-2 text-sm font-medium text-foreground-secondary" title="Tout sélectionner">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={allSelected}
                        onChange={(event) =>
                          setSelection(event.currentTarget.checked ? new Set(drafts.map((line) => line.id)) : new Set())
                        }
                      />
                      <span className="sheet:sr-only">Tout sélectionner</span>
                    </label>
                  </div>
                  <span className="text-sm text-muted-foreground sheet:hidden">{plural(drafts.length, "brouillon", "brouillons")}</span>
                </>
              ) : (
                // Once no line is left to select, the corner stays, empty, over the lines' first column.
                <div aria-hidden="true" className="hidden sheet:block sheet:border-r sheet:border-border" />
              )}
              {(Object.keys(LINE_COLUMNS) as LineColumn[]).map((column, index) => {
                    // The corner cell, over the lines' boxes, is drawn above.
                    if (column === "select") return null;
                    const { title, short } = LINE_COLUMNS[column];
                    // What settles a whole column at once sits in its header: every sure article, every proposed supplier.
                    const all =
                      column === "article" && sureLinks.length > 0
                        ? { name: `Rattacher les références et noms connus (${sureLinks.length})`, verb: "rattacher", count: sureLinks.length, icon: Link2, run: linkSure }
                        : column === "supplier" && proposedSuppliers.length > 0
                          ? { name: `Retenir les fournisseurs proposés (${proposedSuppliers.length})`, verb: "retenir", count: proposedSuppliers.length, icon: Truck, run: retainProposed }
                          : null;
                    return (
                      <div
                        key={column}
                        className={cn(
                          "min-w-0 items-center gap-1.5 max-sheet:contents sheet:flex sheet:px-2 sheet:py-1.5 xl:px-2.5",
                          index > 1 && "sheet:border-l sheet:border-border",
                          column === "quantity" && "sheet:justify-end",
                        )}
                      >
                        <span aria-hidden="true" className="hidden min-w-0 truncate sheet:block">
                          {short ? (
                            <>
                              <span className="xl:hidden">{short}</span>
                              <span className="max-xl:hidden">{title}</span>
                            </>
                          ) : (
                            title
                          )}
                        </span>
                        {all ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-auto min-h-7 whitespace-normal text-left sheet:-my-1 sheet:ml-auto sheet:shrink-0 sheet:whitespace-nowrap sheet:px-1 sheet:text-primary"
                            disabled={busy}
                            aria-label={all.name}
                            title={all.name}
                            onClick={() => void all.run()}
                          >
                            <all.icon aria-hidden="true" className="sheet:hidden" />
                            <span className="sheet:hidden">{all.name}</span>
                            {/* In its column's header the gesture is said in two words: the column names what it acts on. */}
                            <span aria-hidden="true" className="max-sheet:hidden">
                              <span className="max-2xl:hidden">Tout </span>
                              <span className="max-2xl:capitalize">{all.verb}</span> ({all.count})
                            </span>
                          </Button>
                        ) : null}
                      </div>
                    );
              })}
            </div>
          {/* `role="list"`: without it a list with no markers is not announced as one by Safari. */}
          <ol role="list" aria-label="Lignes de la demande" className="space-y-3 sheet:space-y-0">
            {lines.map((line) => renderLine(line))}
          </ol>
          </div>

        </>
      ) : canWrite ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {data.request.source_text?.trim()
              ? "Découpez le message reçu en lignes (« Découper le texte en lignes », dans l’original) ; ou recopiez la demande ligne par ligne."
              : "Collez le message du technicien (« Coller un message », dans l’original) pour le découper ; ou recopiez la demande ligne par ligne."}
          </p>
        </div>
      ) : null}
      {/* The two bulk gestures sit in the header of their column; what says why one has nothing to do is read here. */}
      {canWrite && lines.length > 0 && (linkNothing || supplierNothing || linkReport) ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            {supplierNothing && supplierNothing.missing > 0 && chooseTypeSupplier ? (
              <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={chooseTypeSupplier}>
                Choisir les fournisseurs des types
              </Button>
            ) : null}
          </div>
          {linkNothing || supplierNothing ? (
            <details className="text-sm text-muted-foreground">
              <summary role="button" className="w-fit cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                Détails des propositions
              </summary>
              <div className="mt-2 space-y-1">
                {linkNothing ? <p>{linkNothing}</p> : null}
                {supplierNothing ? <p>{supplierNothing.text}</p> : null}
              </div>
            </details>
          ) : null}
          {linkReport ? (
            <div role="status" className="space-y-0.5 text-sm text-foreground">
              {linkReport.map((sentence) => <p key={sentence}>{sentence}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>
      </div>
      {nextAction ? <div className="flex justify-end border-t border-border py-5">{nextAction}</div> : null}
      {chooseTypeSupplier ? (
        <SupplyTypeSuppliersDialog
          open={typeSuppliersOpen}
          onOpenChange={(open) => {
            setTypeSuppliersOpen(open);
            // A type given a supplier there proposes it here: the proposals are read again on closing.
            if (!open) editor.retrySupplierProposals();
          }}
        />
      ) : null}
      {canWrite ? (
        <MaterialRequestArticleSheet
          editor={editor}
          line={articleLine}
          canCreateSupplyType={canCreateSupplyType}
          onOpenChange={(open) => {
            if (!open) setArticleLineId(null);
          }}
        />
      ) : null}
    </section>
  );
}
