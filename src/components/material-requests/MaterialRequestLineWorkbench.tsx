"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Info, MoreHorizontal, RotateCcw, ShoppingCart, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { effectiveLineMaterial } from "@/lib/material-requests/alerts";
import { MATERIAL_REQUEST_IMPUTATION_LABELS } from "@/lib/material-requests/contracts";
import { cn } from "@/lib/utils";

import { formatQuantity, orderedLineMark, purchaseOrderHref } from "./format";
import { IncompleteArticle, MATCH_LABELS, MaterialRequestArticleCell } from "./MaterialRequestArticleCell";
import type { LineRowProps } from "./MaterialRequestLineRow";
import { MaterialRequestSupplierCell } from "./MaterialRequestSupplierCell";

export const WORKBENCH_COLUMNS = "grid-cols-[minmax(10rem,1.35fr)_4rem_minmax(8rem,1fr)_minmax(8rem,1fr)_6rem_minmax(7rem,0.8fr)_2rem]";

type WorkbenchProps = LineRowProps & { inspected: boolean; onInspect: () => void };

/** A settled row stays compact; all its provenance and existing actions are in the inspector. */
export function MaterialRequestLineSummary(props: WorkbenchProps) {
  const { line, article, request, ordered, inspected, onInspect } = props;
  const material = effectiveLineMaterial(line, { ...request, material_confirmed: request.material_confirmed && line.imputation === "project" });
  const supplier = line.supplier_id ? props.supplierOptions.find((item) => item.id === line.supplier_id)?.label ?? "Fournisseur retiré de la liste" : null;
  const inherited = request.supplier_confirmed && request.presumed_supplier_id
    ? props.supplierOptions.find((item) => item.id === request.presumed_supplier_id)?.label ?? "Fournisseur retiré de la liste"
    : null;
  const mark = ordered ? orderedLineMark(ordered.status, ordered.purchase_order_reference) : null;
  return (
    <li aria-label={`Ligne ${line.position}`} className={cn(
      "relative grid min-w-0 grid-cols-2 items-start gap-x-4 gap-y-2 border-b border-border px-4 py-4 text-sm last:border-b-0 lg:grid-cols-4 xl:grid",
      "xl:grid-cols-[minmax(10rem,1.35fr)_4rem_minmax(8rem,1fr)_minmax(8rem,1fr)_6rem_minmax(7rem,0.8fr)_2rem]",
      inspected ? "border-l-[3px] border-l-primary bg-primary/5 pl-[13px]" : "bg-surface",
    )}>
      <div className="min-w-0">
        <button type="button" aria-label={`Afficher les détails de la ligne ${line.position}`} aria-pressed={inspected} onClick={onInspect}
          className="block max-w-full break-words text-left font-semibold text-foreground hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          {line.product_type || article?.designation || "Article à préciser"}
        </button>
        <p className="mt-0.5 break-all text-xs text-muted-foreground">{article?.reference || line.reference || `Ligne ${line.position}`}</p>
        {article?.designation && article.designation !== line.product_type ? <p className="mt-0.5 text-xs text-muted-foreground">{article.designation}</p> : null}
      </div>
      <p className="font-semibold tabular-nums"><span className="sr-only">Quantité : </span>{line.quantity === null ? "—" : formatQuantity(line.quantity)} {line.unit}</p>
      <div className="min-w-0 break-words">
        {(!line.dimension || line.dimension === "-") && (!material.material || material.material === "-") && !line.no_dimension ? <p className="italic text-muted-foreground">Non renseignées</p> : <><p>{line.dimension || (line.no_dimension ? "Sans dimension" : "Non renseignée")}</p><p className={cn("mt-0.5", !material.material && "italic text-muted-foreground")}>{material.material || "Matière non renseignée"}{material.source === "presumed" ? " (demande)" : ""}</p></>}
      </div>
      <div className="min-w-0 break-words">
        <p className="font-medium">{supplier || (inherited ? `${inherited} (demande)` : "Sans fournisseur")}</p>
        {props.supplierReference?.supplier_sku ? <p className="mt-0.5 break-all text-xs text-muted-foreground">Réf. : {props.supplierReference.supplier_sku}</p> : null}
      </div>
      <div><Badge variant={line.status === "validated" ? "success" : "neutral"}>{line.status === "validated" ? <Check aria-hidden="true" /> : null}{line.status === "validated" ? "Validée" : "Brouillon"}</Badge></div>
      <div className="min-w-0 text-xs">
        {ordered && mark ? ordered.can_open ? (
          <Link href={purchaseOrderHref(ordered.purchase_order_id)} className="inline-flex items-start gap-1 text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"><ShoppingCart aria-hidden="true" className="size-4 shrink-0" />{mark}</Link>
        ) : <span className="text-muted-foreground">{mark}</span> : <span className="text-muted-foreground">Pas encore de bon</span>}
      </div>
      {props.canWrite ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions de la ligne ${line.position}`} onClick={onInspect}><MoreHorizontal aria-hidden="true" /></Button> : <span />}
    </li>
  );
}

/** Reuses the original catalogue and supplier controls: selection never applies or validates a proposal. */
export function MaterialRequestLineInspector(props: LineRowProps) {
  const { line, article, request, ordered, canWrite } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const material = effectiveLineMaterial(line, { ...request, material_confirmed: request.material_confirmed && line.imputation === "project" });
  const ownSupplier = line.supplier_id ? props.supplierOptions.find((item) => item.id === line.supplier_id)?.label ?? "Fournisseur retiré de la liste" : null;
  const inheritedSupplier = request.supplier_confirmed && request.presumed_supplier_id
    ? props.supplierOptions.find((item) => item.id === request.presumed_supplier_id)?.label ?? "Fournisseur retiré de la liste"
    : null;
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
    <aside aria-label={`Détails de la ligne ${line.position}`} className="min-w-0 border-t border-border pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
      <h3 className="mb-6 font-display text-lg font-semibold text-foreground">Ligne {line.position} — {line.product_type || article?.designation || "À préciser"}</h3>
      <dl className="space-y-3 text-sm">
        {values.map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4"><dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-words font-medium text-foreground">{value}</dd></div>)}
      </dl>
      {props.alerts.length > 0 ? <ul aria-label={`Points à régler, ligne ${line.position}`} className="mt-5 space-y-2 text-sm text-warning">{props.alerts.map((alert) => <li key={alert.code} className="flex gap-2">{alert.blocking ? <TriangleAlert aria-hidden="true" className="size-4 shrink-0" /> : <Info aria-hidden="true" className="size-4 shrink-0" />}{alert.message}</li>)}</ul> : null}
      <div className="mt-3 space-y-4">
        <MaterialRequestSupplierCell layout="inspector" line={line} editable={canWrite} supplierOptions={props.supplierOptions} ownSupplier={ownSupplier}
          requestSupplierLabel={inheritedSupplier ? `${inheritedSupplier} (demande)` : null} proposal={props.supplierProposal} reference={props.supplierReference}
          supplyTypeName={article?.supply_type_name ?? null} article={article} proposalRead={props.supplierProposalRead}
          onChooseTypeSupplier={props.onChooseTypeSupplier} onSave={props.onSave} onRetain={props.onRetainSupplier} />
        <dl className="text-sm"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4"><dt className="text-muted-foreground">Imputation</dt><dd className="font-medium">{MATERIAL_REQUEST_IMPUTATION_LABELS[line.imputation]}{line.overhead_category ? ` · ${line.overhead_category}` : ""}</dd></div></dl>
        {article && canWrite && (!article.material?.trim() || !article.dimensions?.trim()) ? <div className="rounded-lg bg-primary/5 p-4"><IncompleteArticle article={article} canEditCatalogue={props.canEditCatalogue} /></div> : null}
        {canWrite ? <details><summary role="button" className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Actions sur la ligne</summary><div className="mt-3 space-y-3">
        <MaterialRequestArticleCell compact line={line} article={article} canWrite={canWrite} canEditCatalogue={props.canEditCatalogue}
          proposals={props.proposals} change={props.change} notice={props.articleNotice} conflict={props.articleConflict}
          onLink={props.onLinkArticle} onUnlink={props.onUnlinkArticle} onOpenPanel={props.onOpenArticles} onRetryProposals={props.onRetryProposals} />
        {line.status === "validated" && canWrite && !ordered ? <Button type="button" variant="outline" size="sm" loading={busy} aria-label={`Rouvrir la ligne ${line.position}`} onClick={async () => {
          setBusy(true);
          const result = await props.onReopen();
          setBusy(false);
          setError(result.ok ? null : result.message);
        }}><RotateCcw aria-hidden="true" />Rouvrir</Button> : null}
        </div></details> : null}
        {line.status === "draft" && canWrite ? <p className="text-sm text-muted-foreground">Modifiez et validez cette ligne dans le tableau.</p> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </aside>
  );
}
