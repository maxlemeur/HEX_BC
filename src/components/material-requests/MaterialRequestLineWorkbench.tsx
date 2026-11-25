"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Pencil, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { effectiveLineMaterial } from "@/lib/material-requests/alerts";
import { MATERIAL_REQUEST_IMPUTATION_LABELS } from "@/lib/material-requests/contracts";
import { cn } from "@/lib/utils";

import { AlertSummary, SELECTED_ROW } from "./cells";
import { formatQuantity, orderedLineMark, purchaseOrderHref } from "./format";
import { IncompleteArticle, MATCH_LABELS, MaterialRequestArticleCell } from "./MaterialRequestArticleCell";
import {
  CELL_LINE,
  CELL_PAD,
  fromRequest,
  LINE_BAND,
  LINE_COLUMNS,
  LINE_GRID,
  MaterialRequestLineToggle,
  supplierFromRequest,
  supplierName,
  type LineRowProps,
} from "./MaterialRequestLineRow";
import { MaterialRequestSupplierCell } from "./MaterialRequestSupplierCell";

type WorkbenchProps = Omit<LineRowProps, "unfolded" | "onUnfoldedChange"> & {
  inspected: boolean;
  onInspect: () => void;
  orderStatusKnown: boolean;
};

/** A cell of the lines sheet that holds a value rather than a field. */
const CELL = cn("sheet:flex sheet:min-h-9 sheet:min-w-0 sheet:items-center sheet:self-stretch sheet:py-0.5", CELL_PAD);
const AT = LINE_COLUMNS;

/**
 * A validated line, or any line read by who may not write: one row of the lines sheet, under the columns of the
 * lines still edited (a card below the sheet's width). Its provenance and its actions are read under the row, on
 * request, as a draft line unfolds.
 */
export function MaterialRequestLineSummary(props: WorkbenchProps) {
  const { line, article, request, ordered, inspected, onInspect, onReopen, canWrite } = props;
  // The details are built the first time the line is inspected, then stay in the page while they are not shown: a
  // supplier choice the server refused, and its reason, are still there when the line is opened again.
  const [opened, setOpened] = useState(inspected);
  if (inspected && !opened) setOpened(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reopen = async () => {
    setBusy(true);
    setError(null);
    const result = await onReopen();
    setBusy(false);
    if (!result.ok) setError(result.message);
  };
  const material = effectiveLineMaterial(line, { ...request, material_confirmed: request.material_confirmed && line.imputation === "project" });
  const supplier = supplierName(props.supplierOptions, line.supplier_id);
  const inherited = supplierFromRequest(request, props.supplierOptions);
  const mark = ordered ? orderedLineMark(ordered.status, ordered.purchase_order_reference) : null;
  const detailsId = `material-request-line-${line.id}-details`;
  const toggleId = `${detailsId}-toggle`;
  const validated = line.status === "validated";
  const noSize = (!line.dimension || line.dimension === "-") && (!material.material || material.material === "-") && !line.no_dimension;
  // In a card the article is not said twice when the line's type already is its designation.
  const sameName = article?.designation !== undefined && article.designation === line.product_type;
  const linked = line.product_id !== null;
  return (
    // Below the sheet's width: a card of two rows, what the line asks beside its state, then its article and supplier.
    <li aria-label={`Ligne ${line.position}`} data-inspected={inspected || undefined} className={cn(
      "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2.5 text-sm sm:px-4",
      "sheet:items-start sheet:gap-0 sheet:rounded-none sheet:border-0 sheet:border-b sheet:p-0 sheet:last:rounded-b-lg sheet:last:border-b-0",
      LINE_GRID,
      inspected ? cn(SELECTED_ROW, "sheet:border-border-strong") : "bg-surface sheet:hover:bg-surface-subtle/60",
    )}>
      <MaterialRequestLineToggle
        id={toggleId}
        label={`Afficher les détails de la ligne ${line.position}`}
        open={inspected}
        controls={opened ? detailsId : undefined}
        onToggle={onInspect}
      />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 sheet:contents">
        <label htmlFor={toggleId}
          className={cn("block max-w-full cursor-pointer break-words text-left font-semibold text-foreground hover:text-primary sheet:font-normal", CELL, CELL_LINE, AT.type.at)}>
          <span className="sheet:truncate">{line.product_type || article?.designation || "Article à préciser"}</span>
        </label>
        <p className="tabular-nums sheet:contents">
          <span className="sr-only">Quantité : </span>
          <span className={cn("sheet:justify-end", CELL, CELL_LINE, AT.quantity.at)}>{line.quantity === null ? "—" : formatQuantity(line.quantity)}</span>{" "}
          <span className={cn(CELL, CELL_LINE, AT.unit.at)}>{line.unit}</span>
        </p>
        <div className="flex min-w-0 flex-wrap gap-x-3 break-words sheet:contents">
          {noSize ? (
            <p className={cn("italic text-muted-foreground sheet:[grid-column:6/8] sheet:row-start-1", CELL, CELL_LINE)}>Non renseignées</p>
          ) : (
            <>
              <p className={cn(CELL, CELL_LINE, AT.dimension.at)}>
                <span className="sheet:truncate">{line.dimension || (line.no_dimension ? "Sans dimension" : "Non renseignée")}</span>
              </p>
              <p className={cn(!material.material && "italic text-muted-foreground", CELL, CELL_LINE, AT.material.at)}>
                <span className="sheet:truncate">{material.material || "Matière non renseignée"}{material.source === "presumed" ? " (demande)" : ""}</span>
              </p>
            </>
          )}
        </div>
      </div>
      <div className={cn(
        "flex items-center justify-end gap-1 sheet:px-1.5", AT.state.at, CELL, CELL_LINE,
        validated && "grid grid-cols-[1.75rem_1.75rem] sheet:grid",
      )}>
        <Badge variant={validated ? "success" : "neutral"} title={validated ? "Validée" : "Brouillon"}
          className={cn(validated && "size-7 shrink-0 justify-center rounded-control px-0")}>
          {validated ? <Check aria-hidden="true" className="size-3.5" /> : null}
          <span className={cn(validated && "sr-only")}>{validated ? "Validée" : "Brouillon"}</span>
        </Badge>
        {canWrite && validated && props.orderStatusKnown && !ordered ? (
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={`Modifier la ligne ${line.position}`}
            title="Rouvrir en brouillon pour modifier"
            loading={busy}
            onClick={() => void reopen()}
          >
            {/* The pencil alone: the row keeps its height, and the word is read on hover and by a screen reader. */}
            <Pencil aria-hidden="true" />
            <span className="sr-only">Modifier</span>
          </Button>
        ) : null}
      </div>
      {/* What the line is bought as, and from whom: under what it asks in a card, in their columns in the sheet. */}
      <div className="col-span-full flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-muted-foreground sheet:contents sheet:text-foreground">
        <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 sheet:flex-nowrap", AT.article.at, CELL, CELL_LINE, sameName && "max-sheet:hidden")}>
          {article?.designation ? (
            <p className="min-w-0 sheet:truncate">{article.designation}</p>
          ) : (
            <p className="text-subtle-foreground">{linked ? "Article rattaché" : "Non rattaché"}</p>
          )}
          {article?.reference || line.reference ? (
            <p className="break-all font-mono text-xs sheet:hidden">{article?.reference || line.reference}</p>
          ) : null}
        </div>
        <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 break-words sheet:flex-nowrap", AT.supplier.at, CELL, CELL_LINE)}>
          <p className={cn("min-w-0 sheet:truncate", !supplier && !inherited && "text-subtle-foreground")}>{supplier || (inherited ? fromRequest(inherited) : "Sans fournisseur")}</p>
          {props.supplierReference?.supplier_sku ? <p className="break-all text-xs sheet:hidden">Réf. : {props.supplierReference.supplier_sku}</p> : null}
        </div>
      </div>
      {/* A line says its purchase order once it has one: « not yet » is every line's case until then. */}
      {ordered && mark ? (
        <div className={cn("col-span-full min-w-0 text-xs sheet:[grid-column:3/-1] sheet:row-start-2 sheet:pb-2", CELL_PAD)}>
          {ordered.can_open ? (
            <Link href={purchaseOrderHref(ordered.purchase_order_id)} className="inline-flex items-start gap-1 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"><ShoppingCart aria-hidden="true" className="size-4 shrink-0" />{mark}</Link>
          ) : <span className="text-muted-foreground">{mark}</span>}
        </div>
      ) : null}
      {error ? <p role="alert" className={cn("col-span-full text-sm text-danger sheet:[grid-column:3/-1] sheet:row-start-3 sheet:pb-2", CELL_PAD)}>{error}</p> : null}
      {opened ? (
        <div id={detailsId} hidden={!inspected} className={cn("col-span-full mt-1.5 min-w-0 border-t border-border pt-3 sheet:mt-0 sheet:row-start-4", LINE_BAND)}>
          <MaterialRequestLineInspector {...props} />
        </div>
      ) : null}
    </li>
  );
}

/** Reuses the original catalogue and supplier controls: selection never applies or validates a proposal. */
function MaterialRequestLineInspector(props: WorkbenchProps) {
  const { line, article, request, canWrite } = props;
  const material = effectiveLineMaterial(line, { ...request, material_confirmed: request.material_confirmed && line.imputation === "project" });
  const ownSupplier = supplierName(props.supplierOptions, line.supplier_id);
  const inheritedSupplier = supplierFromRequest(request, props.supplierOptions);
  const values = [
    ["Article lié", line.product_id ? article ? article.reference ?? "Sans référence" : "Article rattaché" : "Non rattaché"],
    ["Libellé (source)", line.original_text ?? "Ligne ajoutée à la main"],
    ["Quantité", line.quantity === null ? "Non renseignée" : `${formatQuantity(line.quantity)} ${line.unit ?? ""}`],
    ["Dimension / matière", [line.dimension && line.dimension !== "-" ? line.dimension : line.no_dimension ? "Sans dimension" : null, material.material && material.material !== "-" ? `${material.material}${material.source === "presumed" ? " (demande)" : ""}` : null].filter(Boolean).join(" · ") || "Non renseignées"],
    ...(line.product_match && MATCH_LABELS[line.product_match] ? [["Rattachement", MATCH_LABELS[line.product_match]]] : []),
    ...(line.material_precision ? [["Précision / norme", line.material_precision]] : []),
    ...(line.reference ? [["Référence écrite", line.reference]] : []),
    ...(line.zone ? [["Repère", line.zone]] : []),
  ];
  return (
    // Under its row: what the line is on the left, what can still be done to it on the right.
    <aside aria-label={`Détails de la ligne ${line.position}`} className="min-w-0 max-w-5xl md:grid md:grid-cols-2 md:items-start md:gap-x-6">
      {/* The row above already names the line. */}
      <h3 className="sr-only">{line.product_type || article?.designation || "À préciser"}</h3>
      <dl className="space-y-2 text-sm">
        {values.map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4"><dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-words font-medium text-foreground">{value}</dd></div>)}
      </dl>
      <AlertSummary position={line.position} alerts={props.alerts} className="mt-3 space-y-1.5 text-sm md:col-start-1" />
      <div className="mt-3 space-y-4 md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0">
        <MaterialRequestSupplierCell layout="inspector" line={line} editable={canWrite} supplierOptions={props.supplierOptions} ownSupplier={ownSupplier}
          requestSupplierLabel={inheritedSupplier ? fromRequest(inheritedSupplier) : null} proposal={props.supplierProposal} reference={props.supplierReference}
          supplyTypeName={article?.supply_type_name ?? null} article={article} proposalRead={props.supplierProposalRead}
          onChooseTypeSupplier={props.onChooseTypeSupplier} onSave={props.onSave} onRetain={props.onRetainSupplier} onCreateSupplier={props.onCreateSupplier} />
        <dl className="text-sm"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4"><dt className="text-muted-foreground">Imputation</dt><dd className="font-medium">{MATERIAL_REQUEST_IMPUTATION_LABELS[line.imputation]}{line.overhead_category ? ` · ${line.overhead_category}` : ""}</dd></div></dl>
        {article && canWrite && (!article.material?.trim() || !article.dimensions?.trim()) ? <div className="rounded-lg bg-primary/5 p-4"><IncompleteArticle article={article} canEditCatalogue={props.canEditCatalogue} /></div> : null}
        {canWrite ? <details><summary role="button" className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Actions sur la ligne</summary><div className="mt-3 space-y-3">
        <MaterialRequestArticleCell compact line={line} article={article} canWrite={canWrite} canEditCatalogue={props.canEditCatalogue}
          proposals={props.proposals} change={props.change} notice={props.articleNotice} conflict={props.articleConflict}
          onLink={props.onLinkArticle} onUnlink={props.onUnlinkArticle} onOpenPanel={props.onOpenArticles} onRetryProposals={props.onRetryProposals} />
        </div></details> : null}
      </div>
    </aside>
  );
}
