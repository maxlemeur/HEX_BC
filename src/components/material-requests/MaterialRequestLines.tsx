"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CheckCheck, Link2, Plus, Truck } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { SupplyTypeSuppliersDialog } from "@/components/products/SupplyTypeSuppliersDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MaterialRequestBlockedLine, MaterialRequestOrderLink } from "@/lib/material-requests/client";
import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";
import { cn } from "@/lib/utils";

import { lineTitle, plural } from "./format";
import { MaterialRequestArticleSheet } from "./MaterialRequestArticleSheet";
import { MaterialRequestBulkBar } from "./MaterialRequestBulkBar";
import { LINE_COLUMN_TITLES, LINE_GRID, MaterialRequestLineRow } from "./MaterialRequestLineRow";
import { MaterialRequestLineInspector, MaterialRequestLineSummary } from "./MaterialRequestLineWorkbench";
import type {
  ArticleLinkEntry,
  BulkLinkResult,
  BulkRetainResult,
  MaterialRequestEditorApi,
  SaveResult,
  SupplierRetainEntry,
  WithheldLines,
} from "./useMaterialRequestEditor";

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

/**
 * One of the three things a line needs before it is quoted, in the order they are done: where it stands, the
 * shortcut that does the sure ones at once, and why that shortcut has nothing to do when it has not.
 */
function PreparationRow({
  index,
  name,
  done,
  progress,
  hint,
  action,
}: Readonly<{ index: number; name: string; done: boolean; progress: string; hint: ReactNode; action: ReactNode }>) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
          done ? "bg-success-light text-success" : "bg-muted text-foreground-secondary",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : index}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{name}</span>
          <span className="text-muted-foreground">{` · ${progress}`}</span>
          {done ? <span className="sr-only"> (terminé)</span> : null}
        </p>
        {hint ? <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div> : null}
      </div>
      {action}
    </li>
  );
}

export function MaterialRequestLines({
  editor,
  materialListId,
  headingId,
  orderedLine,
  toolbar,
  canEditCatalogue = false,
  original,
  nextAction,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  materialListId: string;
  headingId: string;
  /** The purchase order each ordered line went into (TI-691, delivery 3a). */
  orderedLine?: (lineId: string) => MaterialRequestOrderLink | null;
  /** Read-only actions shown beside the validation button (message, previous requests). */
  toolbar?: ReactNode;
  /** May set a supply type's preferred supplier here (admins and engineers): the gap is filled in place. */
  canEditCatalogue?: boolean;
  original?: ReactNode;
  nextAction?: ReactNode;
}>) {
  const toast = useToast();
  const unitListId = useId();
  const hintIds = useId();
  const [typeSuppliersOpen, setTypeSuppliersOpen] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkReport, setLinkReport] = useState<string[] | null>(null);
  const [inspectedLineId, setInspectedLineId] = useState<string | null>(null);
  const [preparationOpen, setPreparationOpen] = useState(false);
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
  const linkHintId = `${hintIds}-link`;
  const supplierHintId = `${hintIds}-supplier`;
  const validateHintId = `${hintIds}-validate`;
  const selectAllHintId = `${hintIds}-select-all`;
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

  const linkedCount = lines.filter((line) => line.product_id).length;
  // A retained quote prices a line from its own supplier.
  const suppliedCount = lines.filter((line) => line.supplier_id || line.price_quote_id).length;
  const BULK_BUTTON = "h-auto min-h-8 max-w-full whitespace-normal py-1";
  const prepared = lines.length > 0 && drafts.length === 0 && linkedCount === lines.length && suppliedCount === lines.length;
  const settled = lines.every((line) => line.status === "validated" || !canWrite);
  const inspectedLine = lines.find((line) => line.id === inspectedLineId) ?? lines[lines.length - 1] ?? null;
  const renderLine = (line: MaterialRequestLine, inspector = false) => {
    const Component = inspector ? MaterialRequestLineInspector : line.status === "validated" || !canWrite ? MaterialRequestLineSummary : MaterialRequestLineRow;
    return (
      <Component
                key={line.id}
                line={line}
                showFieldLabels={!settled}
                inspected={inspectedLine?.id === line.id}
                onInspect={() => setInspectedLineId(line.id)}
                alerts={alertsByLine.get(line.id) ?? []}
                request={data.request}
                supplierOptions={data.supplierOptions}
                canWrite={inspector && line.status === "draft" ? false : canWrite}
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
              />
    );
  };


  return (
    <section ref={section} aria-labelledby={headingId} className="min-w-0">
      <div className={cn("mr-workbench grid min-w-0 gap-6 py-5", settled && "xl:grid-cols-[minmax(0,1fr)_22rem]")}>
      <div className={cn("min-w-0 space-y-4", settled && "mr-workbench-main")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className={prepared ? "sr-only" : "min-w-0"}>
          <h2 id={headingId} className={prepared ? "sr-only" : "typo-h3 text-foreground"}>
            Lignes
          </h2>
          <p className={prepared ? "sr-only" : "mt-1 text-sm text-muted-foreground"}>
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
        {prepared ? <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="mr-2 flex items-center gap-2 text-left font-semibold focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={preparationOpen} onClick={() => setPreparationOpen((value) => !value)}><Check aria-hidden="true" className="size-6 rounded-full bg-success p-1 text-white" />Préparation de la demande complète</button>
          <Badge variant="success">Articles {linkedCount}/{lines.length}</Badge><Badge variant="success">Fournisseurs {suppliedCount}/{lines.length}</Badge><Badge variant="success">Validation {validatedCount}/{lines.length}</Badge>
        </div> : null}
        {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      </div>

      {lines.length > 0 ? (
        <ol hidden={prepared && !preparationOpen} role="list" aria-label="Préparation des lignes, dans l’ordre" className="divide-y divide-border rounded-lg border border-border bg-surface">
          <PreparationRow
            index={1}
            name="Articles"
            done={linkedCount === lines.length}
            progress={`${linkedCount} sur ${plural(lines.length, "ligne", "lignes")} avec un article du catalogue`}
            hint={linkNothing ? <p id={linkHintId}>{linkNothing}</p> : null}
            action={
              canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={BULK_BUTTON}
                  disabled={sureLinks.length === 0 || busy}
                  aria-describedby={linkNothing ? linkHintId : undefined}
                  onClick={() => void linkSure()}
                >
                  <Link2 aria-hidden="true" />
                  Rattacher les références et noms connus ({sureLinks.length})
                </Button>
              ) : null
            }
          />
          <PreparationRow
            index={2}
            name="Fournisseurs"
            done={suppliedCount === lines.length}
            progress={`${suppliedCount} sur ${plural(lines.length, "ligne", "lignes")} avec un fournisseur`}
            hint={
              supplierNothing ? (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p id={supplierHintId}>{supplierNothing.text}</p>
                  {supplierNothing.missing > 0 && chooseTypeSupplier ? (
                    <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={chooseTypeSupplier}>
                      Choisir les fournisseurs des types
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
            action={
              canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={BULK_BUTTON}
                  disabled={proposedSuppliers.length === 0 || busy}
                  aria-describedby={supplierNothing ? supplierHintId : undefined}
                  onClick={() => void retainProposed()}
                >
                  <Truck aria-hidden="true" />
                  Retenir les fournisseurs proposés ({proposedSuppliers.length})
                </Button>
              ) : null
            }
          />
          <PreparationRow
            index={3}
            name="Validation"
            done={drafts.length === 0}
            progress={`${validatedCount} sur ${plural(lines.length, "ligne validée", "lignes validées")}`}
            hint={
              canWrite && drafts.length > 0 && clearIds.length === 0 ? (
                <p id={validateHintId}>
                  Aucune ligne à valider d’un coup : chaque ligne en brouillon porte une alerte à régler, ou une remarque à
                  lire avant de la valider par son propre bouton.
                </p>
              ) : null
            }
            action={
              canWrite ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className={BULK_BUTTON}
                  disabled={clearIds.length === 0 || busy}
                  aria-describedby={drafts.length > 0 && clearIds.length === 0 ? validateHintId : undefined}
                  onClick={() => void validate(clearIds)}
                >
                  <CheckCheck aria-hidden="true" />
                  Valider les lignes sans alerte ({clearIds.length})
                </Button>
              ) : null
            }
          />
        </ol>
      ) : null}
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

      <datalist id={unitListId}>
        {MEASUREMENT_UNITS.filter((unit) => unit.active && unit.dimension !== "inch").map((unit) => (
          <option key={unit.code} value={unit.code} label={unit.label} />
        ))}
      </datalist>

      {canWrite && drafts.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            {/* The label is the checkbox's whole name: what follows it describes it. */}
            <label className="flex w-fit items-center gap-2 font-medium text-foreground-secondary">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-describedby={selectAllHintId}
                checked={allSelected}
                onChange={(event) =>
                  setSelection(event.currentTarget.checked ? new Set(drafts.map((line) => line.id)) : new Set())
                }
              />
              Tout sélectionner
            </label>
            <span id={selectAllHintId} className="text-muted-foreground">
              {`· ${plural(drafts.length, "ligne en brouillon", "lignes en brouillon")}, pour les remplir ou les valider ensemble`}
            </span>
          </div>
          {/*
            The form is shown once a line is checked: until then it could do nothing. It stays mounted, so that the
            field chosen and the value typed survive a line unchecked then checked again.
          */}
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
        </div>
      ) : null}

      {lines.length > 0 ? (
        <>
          {/* A table on the whole width at desktop width, cards below it: see `MaterialRequestLineRow`. */}
          <div className="xl:rounded-lg xl:border xl:border-border xl:bg-surface">
            <div
              aria-hidden="true"
              className={cn(
                settled ? "xl:grid xl:grid-cols-[minmax(10rem,1.35fr)_4rem_minmax(8rem,1fr)_minmax(8rem,1fr)_6rem_minmax(7rem,0.8fr)_2rem] xl:gap-x-4" : LINE_GRID,
                // Stuck under the application's top bar (60 px, itself stuck at the top of the window).
                "hidden rounded-t-lg border-b border-border bg-surface-subtle px-4 py-3 text-xs font-medium text-muted-foreground",
                !settled && "xl:hidden",
                settled ? "xl:sticky xl:top-[60px] xl:z-10" : "xl:sticky xl:top-[60px] xl:z-10",
              )}
            >
              {(settled ? ["Article", "Qté", "Dimension / matière", "Fournisseur", "Statut", "Bon", "Actions"] : LINE_COLUMN_TITLES).map((title, index) => (
                <span key={title} className={cn("min-w-0", !settled && index < 2 && "text-right", index === 1 && "pr-2")}>
                  {title}
                </span>
              ))}
            </div>
          {/* `role="list"`: without it a list with no markers is not announced as one by Safari. */}
          <ol role="list" aria-label="Lignes de la demande" className="space-y-3 xl:space-y-0">
            {lines.map((line) => renderLine(line))}
          </ol>
          </div>

        </>
      ) : canWrite ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {data.request.source_text?.trim()
              ? "Découpez le message reçu en lignes (« Découper le texte en lignes », sous le message) ; ou recopiez la demande ligne par ligne."
              : "Collez le message du technicien (« Coller un message », dans l’original) pour le découper ; ou recopiez la demande ligne par ligne."}
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
      {original ? <div className={settled ? "mr-workbench-original" : "pt-8"}>{original}</div> : null}
      </div>
      {lines.filter((line) => line.status === "validated" || !canWrite).map((line) => <div key={line.id} hidden={inspectedLine?.id !== line.id} className="min-w-0">{renderLine(line, true)}</div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5">
        {canWrite && lines.length > 0 ? <Button type="button" variant="outline" disabled={busy} onClick={() => void addLine()}><Plus aria-hidden="true" />Ajouter une ligne</Button> : <span />}
        {nextAction}
      </div>
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
          onOpenChange={(open) => {
            if (!open) setArticleLineId(null);
          }}
        />
      ) : null}
    </section>
  );
}
