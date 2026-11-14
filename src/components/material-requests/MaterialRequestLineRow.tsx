"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, Info, RotateCcw, ShoppingCart, Trash2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { effectiveLineMaterial, type MaterialRequestLineAlert } from "@/lib/material-requests/alerts";
import type { MaterialRequestOrderLink, MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import {
  MATERIAL_REQUEST_IMPUTATION_LABELS,
  MATERIAL_REQUEST_IMPUTATIONS,
  type MaterialRequest,
  type MaterialRequestArticleCandidate,
  type MaterialRequestArticleSummary,
  type MaterialRequestImputation,
  type MaterialRequestLine,
  type MaterialRequestLineInput,
} from "@/lib/material-requests/contracts";
import type { LineSupplierProposal, LineSupplierReference } from "@/lib/material-requests/supplier-contracts";
import { cn } from "@/lib/utils";

import {
  alertCellClass,
  ChoiceCell,
  ConfirmButton,
  QuantityCell,
  TextCell,
  ToggleCell,
  type CellAlerts,
  type ChoiceOption,
} from "./cells";
import { formatQuantity, orderedLineMark, purchaseOrderHref } from "./format";
import { MaterialRequestArticleCell } from "./MaterialRequestArticleCell";
import { MaterialRequestSupplierCell } from "./MaterialRequestSupplierCell";
import type {
  ArticleNotice,
  LineChangeState,
  LineProposals,
  RetainResult,
  SaveResult,
} from "./useMaterialRequestEditor";

const IMPUTATION_OPTIONS: ChoiceOption[] = MATERIAL_REQUEST_IMPUTATIONS.map((value) => ({
  value,
  label: MATERIAL_REQUEST_IMPUTATION_LABELS[value],
}));

export type LineRowProps = Readonly<{
  line: MaterialRequestLine;
  showFieldLabels?: boolean;
  alerts: readonly MaterialRequestLineAlert[];
  request: RequestPresumptions;
  supplierOptions: readonly MaterialRequestSupplierOption[];
  canWrite: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  /** A change of this line is on its way, or could not be saved and is still on screen. */
  change: LineChangeState | undefined;
  onSave: (patch: MaterialRequestLineInput) => Promise<SaveResult>;
  /** The operator dropped a value that could not be saved in these columns. */
  onForget: (fields: readonly string[]) => void;
  onDelete: () => Promise<SaveResult>;
  onValidate: () => Promise<SaveResult>;
  onReopen: () => Promise<SaveResult>;
  materialListId: string;
  unitListId: string;
  /** The article linked to the line, when there is one. */
  article: MaterialRequestArticleSummary | null;
  proposals: LineProposals;
  articleNotice: ArticleNotice | undefined;
  articleConflict: string | undefined;
  /** `learnAlias`: the office checked « Mémoriser … comme nom usuel » (TI-691); never by default. */
  onLinkArticle: (candidate: MaterialRequestArticleCandidate, learnAlias: boolean) => Promise<SaveResult>;
  onUnlinkArticle: () => Promise<SaveResult>;
  onOpenArticles: () => void;
  onRetryProposals: () => void;
  /** The supplier proposed for the line, while it has none (TI-691). */
  supplierProposal: LineSupplierProposal | null;
  /** The article's reference at the line's own supplier, when the catalogue knows it. */
  supplierReference: LineSupplierReference | null;
  /** The supplier proposals were read for the line as it is now. */
  supplierProposalRead: boolean;
  /** Opens the preferred suppliers of the supply types; null for who may not change them. */
  onChooseTypeSupplier: (() => void) | null;
  /** May complete a linked article's sheet (admins and engineers). */
  canEditCatalogue: boolean;
  onRetainSupplier: (supplierId: string) => Promise<RetainResult>;
  /** The purchase order the line went into (TI-691, delivery 3a); null while it is not ordered. */
  ordered?: MaterialRequestOrderLink | null;
}>;

function alertsOf(alerts: readonly MaterialRequestLineAlert[], field: MaterialRequestLineAlert["field"]): CellAlerts {
  return alerts.filter((alert) => alert.field === field);
}

function supplierName(options: readonly MaterialRequestSupplierOption[], id: string | null): string | null {
  if (!id) return null;
  return options.find((option) => option.id === id)?.label ?? "Fournisseur retiré de la liste";
}

type RequestPresumptions = Pick<
  MaterialRequest,
  "presumed_material" | "material_confirmed" | "presumed_supplier_id" | "supplier_confirmed"
>;

/**
 * What a line that names no material of its own is ordered in: the request's presumed material, once the
 * operator has confirmed it (an unconfirmed presumption applies to nothing), and never for overhead.
 */
function materialFromRequest(line: MaterialRequestLine, request: RequestPresumptions): string | null {
  if (line.imputation !== "project") return null;
  const effective = effectiveLineMaterial({ material: null }, request);
  return effective.source === "presumed" ? effective.material : null;
}

/** The supplier named at the top of the sheet, once confirmed: proposed on lines that name none. */
function supplierFromRequest(
  request: RequestPresumptions,
  options: readonly MaterialRequestSupplierOption[],
): string | null {
  return request.supplier_confirmed ? supplierName(options, request.presumed_supplier_id) : null;
}

/** A value that comes from the request, shown apart from one typed on the line. */
function fromRequest(value: string): string {
  return `${value} (demande)`;
}

function AlertSummary({ position, alerts }: Readonly<{ position: number; alerts: readonly MaterialRequestLineAlert[] }>) {
  if (alerts.length === 0) return null;
  return (
    <ul aria-label={`Points à régler, ligne ${position}`} className="space-y-0.5 text-xs text-warning">
      {alerts.map((alert) => (
        <li key={alert.code} className={cn("flex items-start gap-1 font-medium", !alert.blocking && "font-normal")}>
          {alert.blocking ? (
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          ) : (
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          )}
          <span>{alert.blocking ? alert.message : `À noter : ${alert.message}`}</span>
        </li>
      ))}
    </ul>
  );
}

/*
 * One markup, two layouts (TI-691). At desktop width the lines are a table on the whole width of the page, as in the
 * estimate editor: every line is a grid row on the columns below, under one header, with the article and the supplier
 * in view without scrolling sideways. Below that width the same line stacks into a card. Each field keeps its own
 * accessible name (« Quantité, ligne 3 ») in both.
 */

/** The columns of the lines table at desktop width, shared by its header and by every line. */
export const LINE_GRID =
  "xl:grid xl:grid-cols-[3.75rem_4.5rem_4rem_minmax(8.5rem,1.4fr)_minmax(6rem,0.7fr)_minmax(7rem,0.9fr)_minmax(14rem,1.6fr)_minmax(13rem,1.3fr)_8.5rem] xl:gap-x-2.5";

/** The header of the lines table, in the order of `LINE_GRID`. */
export const LINE_COLUMN_TITLES = ["N°", "Quantité", "Unité", "Type", "DN / dimension", "Matière", "Article", "Fournisseur", "État"] as const;

/** Where each part of a line sits in the table. The first row holds what is asked; the rows under it, its details. */
const AT = {
  select: "xl:[grid-column:1] xl:row-start-1",
  quantity: "xl:[grid-column:2] xl:row-start-1",
  unit: "xl:[grid-column:3] xl:row-start-1",
  type: "xl:[grid-column:4] xl:row-start-1",
  dimension: "xl:[grid-column:5] xl:row-start-1",
  material: "xl:[grid-column:6] xl:row-start-1",
  article: "xl:[grid-column:7] xl:row-start-1 xl:row-span-3",
  supplier: "xl:[grid-column:8] xl:row-start-1 xl:row-span-3",
  state: "xl:[grid-column:9] xl:row-start-1 xl:row-span-3",
  wording: "xl:[grid-column:2/7] xl:row-start-2",
  details: "xl:[grid-column:2/7] xl:row-start-3",
} as const;

const LINE =
  "min-w-0 space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4 xl:grid-rows-[auto_auto_1fr] xl:items-start xl:gap-y-1.5 xl:space-y-0 xl:rounded-none xl:border-0 xl:border-b xl:px-3 xl:py-2.5 xl:last:rounded-b-lg xl:last:border-b-0";

/** The technician's own words: what the office checks the line against. */
function OriginalWording({ text }: Readonly<{ text: string | null }>) {
  const place = cn("min-w-0 flex-1 basis-48 text-sm text-muted-foreground xl:text-xs", AT.wording);
  if (!text) return <p className={place}>Ligne ajoutée à la main</p>;
  return (
    <p className={cn(place, "break-words")}>
      Texte du technicien : <span className="font-medium text-foreground">« {text} »</span>
    </p>
  );
}

const FIELD_LABEL = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * One field of a line under its visible name; in the table the column header names it instead. The field keeps its
 * own accessible name (« Quantité, ligne 3 », which starts with the visible one); the tint says an alert names it.
 */
function Field({
  name,
  alerts,
  className,
  inTable = false,
  children,
}: Readonly<{ name: string; alerts?: CellAlerts; className?: string; inTable?: boolean; children: ReactNode }>) {
  return (
    <label className={cn("block min-w-0 rounded-md", alerts && alerts.length > 0 && cn("-m-1 p-1", alertCellClass(alerts)), className)}>
      <span className={cn(FIELD_LABEL, inTable && "xl:hidden")}>{name}</span>
      {children}
    </label>
  );
}

/** « Article » and « Fournisseur »: where a line is prepared for the purchase. */
function Sourcing(props: LineRowProps) {
  const { line, request, supplierOptions, canWrite } = props;
  const ownSupplier = supplierName(supplierOptions, line.supplier_id);
  const requestSupplier = supplierFromRequest(request, supplierOptions);
  const block = "min-w-0 rounded-md bg-surface-subtle p-2.5 xl:rounded-none xl:bg-transparent xl:p-0";
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:contents">
      <div className={cn(block, AT.article)}>
        <p className={cn(FIELD_LABEL, "xl:hidden")}>Article</p>
        <MaterialRequestArticleCell
          line={line}
          article={props.article}
          canWrite={canWrite}
          canEditCatalogue={props.canEditCatalogue}
          proposals={props.proposals}
          change={props.change}
          notice={props.articleNotice}
          conflict={props.articleConflict}
          onLink={props.onLinkArticle}
          onUnlink={props.onUnlinkArticle}
          onOpenPanel={props.onOpenArticles}
          onRetryProposals={props.onRetryProposals}
        />
      </div>
      {/* A supplier is purchasing information: the office may set or change it on a validated line too, which stays validated. */}
      <div className={cn(block, AT.supplier)}>
        <p className={cn(FIELD_LABEL, "xl:hidden")}>Fournisseur</p>
        <MaterialRequestSupplierCell
          line={line}
          editable={canWrite}
          supplierOptions={supplierOptions}
          ownSupplier={ownSupplier}
          requestSupplierLabel={requestSupplier ? fromRequest(requestSupplier) : null}
          proposal={line.supplier_id ? null : props.supplierProposal}
          reference={props.supplierReference}
          supplyTypeName={props.article?.supply_type_name ?? null}
          article={props.article}
          proposalRead={props.supplierProposalRead}
          onChooseTypeSupplier={props.onChooseTypeSupplier}
          onSave={props.onSave}
          onRetain={props.onRetainSupplier}
        />
      </div>
    </div>
  );
}

function LineNumber({ position }: Readonly<{ position: number }>) {
  return (
    <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-xs font-semibold tabular-nums text-foreground-secondary">
      <span className="sr-only">Ligne </span>
      {position}
    </span>
  );
}

type AskedKey = "quantity" | "unit" | "type" | "dimension" | "material";

/** The column a settled value sits under, said before it to who does not see the header. */
const ASKED_NAMES: Record<AskedKey, string> = {
  quantity: "Quantité",
  unit: "Unité",
  type: "Type",
  dimension: "DN / dimension",
  material: "Matière",
};

/**
 * What a settled line asks, each value its own element: read on one row in a card, under its column in the table.
 */
function AskedValues({ line, request }: Readonly<{ line: MaterialRequestLine; request: RequestPresumptions }>) {
  // A settled line says what it is really ordered in, as the editable one does: nothing here would read as
  // « no material » on the line that was reviewed.
  const ownMaterial = line.material?.trim() ? line.material : null;
  const requestMaterial = ownMaterial ? null : materialFromRequest(line, request);
  type Shown = { key: AskedKey; node: ReactNode };
  const asked: Array<Shown | null> = [
    line.quantity === null ? null : { key: "quantity", node: <span className="tabular-nums">{formatQuantity(line.quantity)}</span> },
    line.unit ? { key: "unit", node: line.unit } : null,
    line.product_type ? { key: "type", node: line.product_type } : null,
    line.dimension ? { key: "dimension", node: line.dimension } : line.no_dimension ? { key: "dimension", node: "Sans dimension" } : null,
    ownMaterial
      ? { key: "material", node: ownMaterial }
      : requestMaterial
        ? { key: "material", node: fromRequest(requestMaterial) }
        : null,
  ];
  const shown = asked.filter((entry): entry is Shown => entry !== null);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-foreground xl:contents">
      {shown.length === 0 ? <span className={cn("font-normal text-subtle-foreground xl:py-2", AT.type)}>Rien de saisi</span> : null}
      {shown.map((entry, index) => (
        <span key={entry.key} className="inline-flex items-baseline gap-x-2 xl:contents">
          {index > 0 && !(entry.key === "unit" && shown[index - 1]?.key === "quantity") ? (
            <span aria-hidden="true" className="font-normal text-subtle-foreground xl:hidden">
              ·
            </span>
          ) : null}
          <span className={cn("min-w-0 break-words xl:py-2", AT[entry.key], entry.key === "quantity" && "xl:pr-2 xl:text-right")}>
            <span className="sr-only">{`${ASKED_NAMES[entry.key]} : `}</span>
            {entry.node}
          </span>
        </span>
      ))}
    </p>
  );
}

/** The fields a settled line rarely carries, named: shown under what it asks. */
function MoreValues({ line }: Readonly<{ line: MaterialRequestLine }>) {
  const imputation = `${MATERIAL_REQUEST_IMPUTATION_LABELS[line.imputation]}${
    line.imputation === "overhead" && line.overhead_category ? ` · ${line.overhead_category}` : ""
  }`;
  type Named = { key: string; name: string; value: string };
  const rest: Array<Named | null> = [
    line.material_precision ? { key: "precision", name: "Précision / norme", value: line.material_precision } : null,
    line.reference ? { key: "reference", name: "Référence écrite", value: line.reference } : null,
    line.zone ? { key: "zone", name: "Repère", value: line.zone } : null,
    { key: "imputation", name: "Imputation", value: imputation },
  ];
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {rest
        .filter((entry): entry is Named => entry !== null)
        .map((entry) => (
          <div key={entry.key} className="flex min-w-0 gap-1">
            <dt>{entry.name} :</dt>
            <dd className="min-w-0 break-words text-foreground-secondary">{entry.value}</dd>
          </div>
        ))}
    </dl>
  );
}

function SettledLineRow(props: LineRowProps) {
  const { line, alerts, request, canWrite, onReopen, ordered } = props;
  const orderMark = ordered ? orderedLineMark(ordered.status, ordered.purchase_order_reference) : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const validated = line.status === "validated";

  return (
    <li aria-label={`Ligne ${line.position}`} className={cn(LINE, LINE_GRID, validated && "border-success-border bg-success-subtle/40")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 xl:contents">
        <div className={cn("flex items-center xl:justify-end xl:pt-1.5", AT.select)}>
          <LineNumber position={line.position} />
        </div>
        <OriginalWording text={line.original_text} />
      </div>
      <AskedValues line={line} request={request} />
      <div className={cn("min-w-0 space-y-1", AT.details)}>
        <MoreValues line={line} />
        <AlertSummary position={line.position} alerts={alerts} />
        {error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Sourcing {...props} />
      {/* Last in the line, as in its last column: the keyboard reaches the state and its actions after the fields. */}
      <div className={cn("flex flex-wrap items-center gap-2 max-xl:border-t max-xl:border-border max-xl:pt-3 xl:pt-1", AT.state)}>
        {validated ? (
          <Badge variant="success">
            <Check aria-hidden="true" />
            Validée
          </Badge>
        ) : (
          <Badge variant="neutral">Brouillon</Badge>
        )}
        {ordered && orderMark && ordered.can_open ? (
          <Link
            href={purchaseOrderHref(ordered.purchase_order_id)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ShoppingCart aria-hidden="true" className="size-3.5 shrink-0" />
            {orderMark}
          </Link>
        ) : ordered && orderMark ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ShoppingCart aria-hidden="true" className="size-3.5 shrink-0" />
            {orderMark}
          </span>
        ) : null}
        {/* An ordered line is bought: it is no longer reopened from the request. */}
        {validated && canWrite && !ordered ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy}
            aria-label={`Rouvrir la ligne ${line.position}`}
            onClick={async () => {
              setBusy(true);
              const result = await onReopen();
              setBusy(false);
              setError(result.ok ? null : result.message);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Rouvrir
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function EditableLineRow(props: LineRowProps) {
  const {
    line,
    alerts,
    request,
    selected,
    onSelectedChange,
    change,
    onSave,
    onForget,
    onDelete,
    onValidate,
    materialListId,
    unitListId,
  } = props;
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const n = line.position;
  const blocking = alerts.filter((alert) => alert.blocking);
  const duplicate = alerts.some((alert) => alert.code === "possible_duplicate");
  const requestMaterial = materialFromRequest(line, request);
  const summaryId = `material-request-line-${line.id}-summary`;
  const moreId = `material-request-line-${line.id}-more`;
  // The fields a sheet rarely fills are shown on demand; a line that holds one shows them from the start.
  const holdsMore = Boolean(
    line.material_precision || line.reference || line.zone || line.imputation !== "project" || line.overhead_category,
  );
  // Until the office opens or closes them itself, they follow the line: a bulk fill of one of them shows at once.
  const [moreChoice, setMoreChoice] = useState<boolean | null>(null);
  const moreOpen = moreChoice ?? holdsMore;
  // A change the server refused is still in its cell: validating now would validate the older value.
  const unsaved = change === "failed";

  const act = async (action: () => Promise<SaveResult>) => {
    const result = await action();
    setError(result.ok || result.blocked ? null : result.message);
    return result;
  };

  return (
    <li aria-label={`Ligne ${n}`} className={cn(LINE, LINE_GRID, selected && "border-primary/50 bg-primary/5")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 xl:contents">
        <div className={cn("flex items-center gap-2 xl:justify-end xl:pt-1.5", AT.select)}>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            aria-label={`Sélectionner la ligne ${n}`}
            checked={selected}
            onChange={(event) => onSelectedChange(event.currentTarget.checked)}
          />
          <LineNumber position={n} />
        </div>
        <OriginalWording text={line.original_text} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-[5.5rem_5.5rem_minmax(0,1fr)] lg:grid-cols-[5.5rem_5.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)] xl:contents">
        <Field name="Quantité" inTable={!props.showFieldLabels} alerts={alertsOf(alerts, "quantity")} className={AT.quantity}>
          <QuantityCell
            label={`Quantité, ligne ${n}`}
            value={line.quantity}
            alerts={alertsOf(alerts, "quantity")}
            quietAlerts
            onCommit={(quantity) => onSave({ quantity })}
            onAbandon={() => onForget(["quantity"])}
          />
        </Field>
        <Field name="Unité" inTable={!props.showFieldLabels} alerts={alertsOf(alerts, "unit")} className={AT.unit}>
          <TextCell
            label={`Unité, ligne ${n}`}
            value={line.unit}
            list={unitListId}
            maxLength={20}
            alerts={alertsOf(alerts, "unit")}
            quietAlerts
            onCommit={(unit) => onSave({ unit })}
            onAbandon={() => onForget(["unit"])}
          />
        </Field>
        <Field name="Type" inTable={!props.showFieldLabels} alerts={alertsOf(alerts, "product_type")} className={cn("col-span-2 sm:col-span-1", AT.type)}>
          <TextCell
            label={`Type, ligne ${n}`}
            value={line.product_type}
            maxLength={200}
            alerts={alertsOf(alerts, "product_type")}
            quietAlerts
            onCommit={(product_type) => onSave({ product_type })}
            onAbandon={() => onForget(["product_type"])}
          />
        </Field>
        <Field name="DN / dimension" inTable={!props.showFieldLabels} alerts={alertsOf(alerts, "dimension")} className={cn("sm:col-span-2 lg:col-span-1", AT.dimension)}>
          <TextCell
            label={`DN / dimension, ligne ${n}`}
            value={line.dimension}
            maxLength={80}
            placeholder={line.no_dimension ? "Sans dimension" : undefined}
            alerts={alertsOf(alerts, "dimension")}
            quietAlerts
            onCommit={(dimension) => onSave({ dimension })}
            onAbandon={() => onForget(["dimension"])}
          />
        </Field>
        <Field name="Matière" inTable={!props.showFieldLabels} alerts={alertsOf(alerts, "material")} className={AT.material}>
          <TextCell
            label={`Matière, ligne ${n}`}
            value={line.material}
            list={materialListId}
            maxLength={120}
            placeholder={requestMaterial ? fromRequest(requestMaterial) : undefined}
            alerts={alertsOf(alerts, "material")}
            quietAlerts
            onCommit={(material) => onSave({ material })}
            onAbandon={() => onForget(["material"])}
          />
        </Field>
      </div>

      <div className={cn("min-w-0 space-y-2", AT.details)}>
        <div id={summaryId} className="min-w-0 space-y-1 empty:hidden">
          <AlertSummary position={n} alerts={alerts} />
          {unsaved ? (
            <p className="text-xs font-medium text-danger">
              Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être validée en l’état.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ToggleCell
            label={`Quantité à vérifier, ligne ${n}`}
            text="Quantité à vérifier"
            checked={line.quantity_doubtful}
            onCommit={(quantity_doubtful) => onSave({ quantity_doubtful })}
          />
          <ToggleCell
            label={`Sans dimension, ligne ${n}`}
            text="Sans dimension"
            checked={line.no_dimension}
            onCommit={(no_dimension) => onSave({ no_dimension })}
          />
          {duplicate ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={`Doublon : garder la ligne ${n}`}
              onClick={() => void act(() => onSave({ duplicate_acknowledged: true }))}
            >
              Doublon : garder cette ligne
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-ml-1.5"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            aria-label={`Précision, référence, repère, imputation : ligne ${n}`}
            onClick={() => setMoreChoice(!moreOpen)}
          >
            <ChevronDown aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", moreOpen && "rotate-180")} />
            Précision, référence, repère, imputation
          </Button>
        </div>

        <div id={moreId} hidden={!moreOpen} className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4">
          <Field name="Précision / norme">
            <TextCell
              label={`Précision / norme, ligne ${n}`}
              value={line.material_precision}
              maxLength={120}
              onCommit={(material_precision) => onSave({ material_precision })}
              onAbandon={() => onForget(["material_precision"])}
            />
          </Field>
          <Field name="Référence écrite">
            <TextCell
              label={`Référence écrite, ligne ${n}`}
              value={line.reference}
              maxLength={120}
              // The one the technician wrote: the catalogue's « référence » or a supplier's « référence fournisseur ».
              placeholder="Telle que le technicien l’a écrite"
              onCommit={(reference) => onSave({ reference })}
              onAbandon={() => onForget(["reference"])}
            />
          </Field>
          <Field name="Repère">
            <TextCell
              label={`Repère, ligne ${n}`}
              value={line.zone}
              maxLength={80}
              onCommit={(zone) => onSave({ zone })}
              onAbandon={() => onForget(["zone"])}
            />
          </Field>
          <div className="min-w-0">
            <Field name="Imputation">
              <ChoiceCell
                label={`Imputation, ligne ${n}`}
                value={line.imputation}
                options={IMPUTATION_OPTIONS}
                onCommit={(next) => {
                  const imputation = (next ?? "project") as MaterialRequestImputation;
                  return onSave(imputation === "project" ? { imputation, overhead_category: null } : { imputation });
                }}
              />
            </Field>
            {line.imputation === "overhead" ? (
              <div className="mt-1">
                <TextCell
                  label={`Catégorie de frais généraux, ligne ${n}`}
                  value={line.overhead_category}
                  maxLength={80}
                  placeholder="Catégorie (ex. EPI)"
                  onCommit={(overhead_category) => onSave({ overhead_category })}
                  onAbandon={() => onForget(["overhead_category"])}
                />
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <Sourcing {...props} />
      {/* Last in the line, as in its last column: the keyboard reaches the state and its actions after the fields. */}
      <div className={cn("flex flex-wrap items-center gap-2 max-xl:border-t max-xl:border-border max-xl:pt-3 xl:pt-0.5", AT.state)}>
        <Badge variant="neutral">Brouillon</Badge>
        {blocking.length > 0 ? <Badge variant="warning">{blocking.length} à régler</Badge> : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={validating}
          disabled={blocking.length > 0 || unsaved}
          aria-label={`Valider la ligne ${n}`}
          aria-describedby={blocking.length > 0 || unsaved ? summaryId : undefined}
          onClick={async () => {
            setValidating(true);
            await act(onValidate);
            setValidating(false);
          }}
        >
          <Check aria-hidden="true" />
          Valider
        </Button>
        <ConfirmButton
          label={`Supprimer la ligne ${n}`}
          confirmLabel={`Confirmer la suppression de la ligne ${n}`}
          confirmText="Supprimer ?"
          size="icon-sm"
          onConfirm={() => act(onDelete)}
        >
          <Trash2 aria-hidden="true" />
        </ConfirmButton>
      </div>
    </li>
  );
}

/**
 * One line of the request: edited in place while it is a draft, settled once validated. A row of the lines table at
 * desktop width, a card below it.
 */
export function MaterialRequestLineRow(props: LineRowProps) {
  return props.line.status === "validated" || !props.canWrite ? (
    <SettledLineRow {...props} />
  ) : (
    <EditableLineRow {...props} />
  );
}
