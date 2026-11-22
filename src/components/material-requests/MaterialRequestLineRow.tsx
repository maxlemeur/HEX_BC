"use client";

import { useState, type ReactNode } from "react";
import { Check, Trash2, TriangleAlert } from "lucide-react";

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
  AlertSummary,
  AlertWords,
  ChoiceCell,
  ConfirmButton,
  FoldArrow,
  QuantityCell,
  TextCell,
  ToggleCell,
  type CellAlerts,
  type ChoiceOption,
} from "./cells";
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
  alerts: readonly MaterialRequestLineAlert[];
  request: RequestPresumptions;
  supplierOptions: readonly MaterialRequestSupplierOption[];
  canWrite: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  /**
   * Whether the office unfolded or folded the draft line itself; null until it did: the line then shows what it holds.
   * Kept by the sheet, which unfolds a line to lead to what settles one of its alerts.
   */
  unfolded: boolean | null;
  onUnfoldedChange: (unfolded: boolean) => void;
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

export function supplierName(options: readonly MaterialRequestSupplierOption[], id: string | null): string | null {
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
export function supplierFromRequest(
  request: RequestPresumptions,
  options: readonly MaterialRequestSupplierOption[],
): string | null {
  return request.supplier_confirmed ? supplierName(options, request.presumed_supplier_id) : null;
}

/** A value that comes from the request, shown apart from one typed on the line. */
export function fromRequest(value: string): string {
  return `${value} (demande)`;
}

/*
 * One markup, two layouts (TI-691). From 1080 px (`sheet:`) the lines are a sheet of cells on the whole width of the
 * page: every line is one grid row on the columns below, under one header. Below that width the same line stacks
 * into a card. Each field keeps its own accessible name (« Quantité, ligne 3 ») in both.
 *
 * In the sheet a line is one row: what it asks, its article, its supplier and its actions, each on one line. A value
 * to fix is said once, by the tint of its cell; its words are read on entering the cell. The technician's words, the
 * reasons behind a proposal, the fields a sheet rarely fills and whatever else explains the row are read once the
 * line is unfolded by its arrow: a request of thirty lines stays one screen.
 */

/** The columns of the lines sheet, shared by its header and by every line. The last one holds the actions. */
export const LINE_GRID =
  "sheet:grid sheet:grid-cols-[2.25rem_4.25rem_3.75rem_minmax(7rem,1.2fr)_minmax(4.5rem,0.7fr)_minmax(5.5rem,0.8fr)_minmax(10rem,1.8fr)_minmax(9rem,1.5fr)_7.25rem] xl:grid-cols-[2.25rem_5.5rem_3.75rem_minmax(8.5rem,1.2fr)_minmax(6rem,0.85fr)_minmax(7rem,0.8fr)_minmax(14rem,1.75fr)_minmax(12rem,1.5fr)_11.5rem]";

/** The cells touch: no gap between the columns and no box around a field, the grid lines bound them (`sheet-cell`). */
export const CELL_LINE = "sheet:border-l sheet:border-border";
/** The padding of a cell that holds text rather than a field: the text sits where a field's own text does. */
export const CELL_PAD = "sheet:px-2.5";

/**
 * The columns of the lines sheet, in the order of `LINE_GRID`: what the header says over each (`short` where the
 * title does not hold in its column under 1280 px) and where its cell sits in a line (`at`). The first row of a line
 * is the line itself; the rows under it show once it is unfolded. The first and the last column carry no title.
 */
export const LINE_COLUMNS = {
  select: { title: "", short: null, at: "sheet:[grid-column:1] sheet:row-start-1" },
  quantity: { title: "Quantité", short: "Qté", at: "sheet:[grid-column:2] sheet:row-start-1" },
  unit: { title: "Unité", short: null, at: "sheet:[grid-column:3] sheet:row-start-1" },
  type: { title: "Type", short: null, at: "sheet:[grid-column:4] sheet:row-start-1" },
  dimension: { title: "DN / dim.", short: null, at: "sheet:[grid-column:5] sheet:row-start-1" },
  material: { title: "Matière", short: null, at: "sheet:[grid-column:6] sheet:row-start-1" },
  article: { title: "Article", short: null, at: "sheet:[grid-column:7] sheet:row-start-1" },
  supplier: { title: "Fournisseur", short: null, at: "sheet:[grid-column:8] sheet:row-start-1" },
  state: { title: "", short: null, at: "sheet:[grid-column:9] sheet:row-start-1" },
} as const;
export type LineColumn = keyof typeof LINE_COLUMNS;

/** What a draft line holds beside its columns: its arrow, and the rows read once it is unfolded. */
const AT = {
  /** The arrow that unfolds the line sits at the end of its actions. */
  toggle: "sheet:[grid-column:9] sheet:row-start-1 sheet:self-start sheet:justify-self-end",
  wording: "sheet:[grid-column:2/7] sheet:row-start-2",
  details: "sheet:[grid-column:2/7] sheet:row-start-3",
  failure: "sheet:[grid-column:2/7] sheet:row-start-4",
  /** A cell that runs the height of an unfolded line. */
  tall: "sheet:row-span-4",
} as const;
const COLUMN = LINE_COLUMNS;

/*
 * Below the sheet's width a line is a card on a grid of its own: its head (the box, the technician's words, its
 * actions and its arrow) on one row, then what it asks, then its article and its supplier. `CARD` gives each part its
 * place there; in the sheet every part is placed by `LINE_COLUMNS` and `AT` instead.
 */
const LINE =
  "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2.5 rounded-lg border border-border bg-surface p-3 sm:px-4 sheet:grid-rows-[auto_auto_auto_1fr] sheet:items-start sheet:gap-0 sheet:rounded-none sheet:border-0 sheet:border-b sheet:p-0 sheet:last:rounded-b-lg sheet:last:border-b-0 sheet:hover:bg-surface-subtle/60";
const CARD = {
  select: "max-sheet:order-1",
  wording: "max-sheet:order-2",
  state: "max-sheet:order-3",
  toggle: "max-sheet:order-4",
  asked: "col-span-full max-sheet:order-5",
  details: "col-span-full max-sheet:order-6",
  sourcing: "col-span-full max-sheet:order-7",
  failure: "col-span-full max-sheet:order-8",
} as const;

/** The technician's own words: what the office checks the line against. In the sheet they are read once unfolded. */
function OriginalWording({ text, shown }: Readonly<{ text: string | null; shown: boolean }>) {
  const place = cn("min-w-0 text-sm text-muted-foreground sheet:pt-2", CARD.wording, CELL_PAD, AT.wording, !shown && "sheet:hidden");
  if (!text) return <p className={place}>Ligne ajoutée à la main</p>;
  return (
    <p className={cn(place, "break-words")}>
      {/* At the head of a card the quotation marks say whose words these are. */}
      <span className="max-sheet:sr-only">Texte du technicien : </span>
      <span className="font-medium text-foreground">« {text} »</span>
    </p>
  );
}

const FIELD_LABEL = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * One field of a line under its visible name; in the sheet the column header names it instead. The field keeps its
 * own accessible name (« Quantité, ligne 3 », which starts with the visible one); the tint says an alert names it.
 *
 * In the sheet the words of the alert, and the choice that settles it without a value (`hint`), open under the cell
 * while the cursor is in it (`mr-cell-hint`): the tint says there is something, the cell says what once entered. In a
 * card that choice sits under its field, and the words are read on the line under the fields, on the card's width.
 */
function Field({
  name,
  alerts,
  className,
  column,
  hint,
  children,
}: Readonly<{
  name: string;
  alerts?: CellAlerts;
  className?: string;
  /** The column of the sheet the field is the cell of; without it, a field read once the line is unfolded. */
  column?: LineColumn;
  /** A choice that belongs to the field (« Sans dimension »): under it in a card, in its hint in the sheet. */
  hint?: ReactNode;
  children: ReactNode;
}>) {
  const noted = alerts ?? [];
  const inTable = column !== undefined;
  return (
    <div
      // What the count over the sheet leads to: see `lineAlertTarget`.
      data-line-field={column}
      // On hover, what the tint of the cell means.
      title={noted.length > 0 ? noted.map((alert) => alert.message).join(" ") : undefined}
      className={cn(
        "min-w-0 rounded-md",
        // In a card the tint is a halo around the field; in the sheet it fills the cell.
        noted.length > 0 && cn("max-sheet:-m-1.5 max-sheet:p-1.5", alertCellClass(noted)),
        inTable && cn("mr-cell sheet:sheet-cell sheet:relative sheet:rounded-none", COLUMN[column].at),
        className,
      )}
    >
      <label className="block min-w-0">
        <span className={cn(FIELD_LABEL, inTable && "sheet:hidden")}>{name}</span>
        {children}
      </label>
      {inTable && (noted.length > 0 || hint) ? (
        // In a card the choice keeps to one line, wider than a narrow field if it must.
        <div className={cn("mr-cell-hint space-y-1", hint ? "max-sheet:mt-1.5 max-sheet:w-max" : "max-sheet:hidden")}>
          {/* A card says the alerts under its fields, and the field describes itself to a screen reader: said once. */}
          {noted.map((alert) => (
            <AlertWords key={alert.code} alert={alert} aria-hidden className="text-xs max-sheet:hidden" />
          ))}
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** « Article » and « Fournisseur »: where a line is prepared for the purchase. */
function Sourcing(props: LineRowProps & { expanded: boolean }) {
  const { line, request, supplierOptions, canWrite, expanded } = props;
  const ownSupplier = supplierName(supplierOptions, line.supplier_id);
  const requestSupplier = supplierFromRequest(request, supplierOptions);
  const block = cn("min-w-0 sheet:self-stretch", CELL_LINE);
  return (
    <div className={cn("grid gap-x-4 gap-y-2.5 md:grid-cols-2 sheet:contents", CARD.sourcing)}>
      <div className={cn(block, "sheet:px-2.5 sheet:py-1", COLUMN.article.at, AT.tall)}>
        <p className={cn(FIELD_LABEL, "sheet:hidden")}>Article</p>
        <MaterialRequestArticleCell
          line={line}
          article={props.article}
          canWrite={canWrite}
          canEditCatalogue={props.canEditCatalogue}
          proposals={props.proposals}
          change={props.change}
          notice={props.articleNotice}
          conflict={props.articleConflict}
          expanded={expanded}
          onLink={props.onLinkArticle}
          onUnlink={props.onUnlinkArticle}
          onOpenPanel={props.onOpenArticles}
          onRetryProposals={props.onRetryProposals}
        />
      </div>
      {/* A supplier is purchasing information: the office may set or change it on a validated line too, which stays validated. */}
      <div className={cn(block, "sheet:sheet-cell", COLUMN.supplier.at, AT.tall)}>
        <p className={cn(FIELD_LABEL, "sheet:hidden")}>Fournisseur</p>
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
          expanded={expanded}
          onChooseTypeSupplier={props.onChooseTypeSupplier}
          onSave={props.onSave}
          onRetain={props.onRetainSupplier}
        />
      </div>
    </div>
  );
}

/**
 * One draft line of the request, edited in place: a row of the lines sheet from 1080 px, a card below it. A line
 * that is validated, or read by who may not write, is a `MaterialRequestLineSummary`.
 */
export function MaterialRequestLineRow(props: LineRowProps) {
  const {
    line,
    alerts,
    request,
    selected,
    onSelectedChange,
    unfolded,
    onUnfoldedChange,
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
  // What holds the line without a cell to tint: said by a mark beside its actions, which unfolds it.
  const offCell = alerts.filter((alert) => alert.field === null);
  const requestMaterial = materialFromRequest(line, request);
  const summaryId = `material-request-line-${line.id}-summary`;
  const moreId = `material-request-line-${line.id}-more`;
  // The fields a sheet rarely fills are shown on demand; a line that holds one shows them from the start.
  const holdsMore = Boolean(
    line.material_precision || line.zone || line.imputation !== "project" || line.overhead_category,
  );
  // Until the office opens or closes them itself, they follow the line: a bulk fill of one of them shows at once.
  const moreOpen = unfolded ?? holdsMore;
  // A change the server refused is still in its cell: validating now would validate the older value.
  const unsaved = change === "failed";
  // Unfolded, a line under the fields parts them from what is read below.
  const cell = cn(CELL_LINE, moreOpen && "sheet:border-b sheet:border-border");

  const act = async (action: () => Promise<SaveResult>) => {
    const result = await action();
    setError(result.ok || result.blocked ? null : result.message);
    return result;
  };

  return (
    <li id={`material-request-line-${line.id}`} tabIndex={-1} aria-label={`Ligne ${n}`} className={cn(LINE, LINE_GRID, selected && "border-primary/50 bg-primary/5 sheet:hover:bg-primary/5")}>
      {/* The cell runs the height of the line; the box stays on the row of the fields. */}
        <div className={cn("sheet:self-stretch sheet:border-r sheet:border-border", CARD.select, COLUMN.select.at, AT.tall)}>
          <div className="flex items-center sheet:h-9 sheet:justify-center">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              aria-label={`Sélectionner la ligne ${n}`}
              checked={selected}
              onChange={(event) => onSelectedChange(event.currentTarget.checked)}
            />
          </div>
        </div>
      <OriginalWording text={line.original_text} shown={moreOpen} />

      {/* In a card: quantity, unit and type on a row, size and material under them; from 768 px, the five on one row. */}
      <div className={cn("grid grid-cols-[4.5rem_4rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 md:grid-cols-[5rem_4.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)] sheet:contents", CARD.asked)}>
        <Field
          name="Quantité"
          column="quantity"
          alerts={alertsOf(alerts, "quantity")}
          className={cn(moreOpen && "sheet:border-b sheet:border-border")}
          hint={
            moreOpen || line.quantity_doubtful ? (
              <ToggleCell
                label={`Quantité à vérifier, ligne ${n}`}
                text="Quantité à vérifier"
                checked={line.quantity_doubtful}
                onCommit={(quantity_doubtful) => onSave({ quantity_doubtful })}
              />
            ) : null
          }
        >
          <QuantityCell
            label={`Quantité, ligne ${n}`}
            value={line.quantity}
            alerts={alertsOf(alerts, "quantity")}
            quietAlerts
            onCommit={(quantity) => onSave({ quantity })}
            onAbandon={() => onForget(["quantity"])}
          />
        </Field>
        <Field name="Unité" column="unit" alerts={alertsOf(alerts, "unit")} className={cell}>
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
        <Field name="Type" column="type" alerts={alertsOf(alerts, "product_type")} className={cell}>
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
        <Field
          name="DN / dimension"
          column="dimension"
          alerts={alertsOf(alerts, "dimension")}
          className={cn("max-md:col-span-2", cell)}
          hint={
            moreOpen || line.no_dimension || !line.dimension ? (
              <ToggleCell
                label={`Sans dimension, ligne ${n}`}
                text="Sans dimension"
                checked={line.no_dimension}
                onCommit={(no_dimension) => onSave({ no_dimension })}
              />
            ) : null
          }
        >
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
        <Field name="Matière" column="material" alerts={alertsOf(alerts, "material")} className={cell}>
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

      {/* The arrow that unfolds the line: at the end of its row in the sheet, at the end of its head in a card. */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn("w-7 px-0 sheet:relative sheet:z-[1] sheet:my-1 sheet:mr-1.5", CARD.toggle, AT.toggle)}
        aria-expanded={moreOpen}
        aria-controls={moreId}
        aria-label={`Détails de la ligne ${n}`}
        title={moreOpen ? "Replier la ligne" : "Déplier la ligne"}
        onClick={() => onUnfoldedChange(!moreOpen)}
      >
        <FoldArrow open={moreOpen} />
      </Button>

      <div
        className={cn(
          "min-w-0 space-y-2 sheet:pb-2.5 sheet:pt-1.5",
          CARD.details,
          CELL_PAD,
          AT.details,
          !moreOpen && "sheet:hidden",
          // A folded card keeps the words of its alerts under its fields; with none, this part takes no room.
          !moreOpen && alerts.length === 0 && !unsaved && "max-sheet:hidden",
        )}
      >
        <div id={summaryId} className="min-w-0 space-y-1 empty:hidden">
          <AlertSummary position={n} alerts={alerts} />
          {unsaved ? (
            <p className="text-xs font-medium text-danger">
              Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être validée en l’état.
            </p>
          ) : null}
        </div>
        {duplicate ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-line-alert="possible_duplicate"
            aria-label={`Doublon : garder la ligne ${n}`}
            onClick={() => void act(() => onSave({ duplicate_acknowledged: true }))}
          >
            Doublon : garder cette ligne
          </Button>
        ) : null}

        <div id={moreId} hidden={!moreOpen} className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-4">
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
      </div>

      {/* What an action of the line could not do is said whether the line is folded or not. */}
      {error ? (
        <p role="alert" className={cn("text-xs font-medium text-danger sheet:pb-2", CARD.failure, CELL_PAD, AT.failure)}>
          {error}
        </p>
      ) : null}

      <Sourcing {...props} expanded={moreOpen} />
      {/* Last in the line, as in its last column: the keyboard reaches the state and its actions after the fields. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-1 sheet:content-start sheet:self-stretch sheet:py-0.5 sheet:pl-1.5 sheet:pr-9",
          CARD.state,
          CELL_LINE,
          COLUMN.state.at,
          AT.tall,
        )}
      >
        {/*
          Every editable line is a draft and « Valider » says so, and what holds the line is the tint of its fields:
          the words are kept for a screen reader.
        */}
        <span className="sr-only">
          <span>Brouillon</span>
          {blocking.length > 0 ? `, ${blocking.length} à régler` : ""}
        </span>
        {offCell.length > 0 && !moreOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-warning max-sheet:hidden"
            aria-label={`Voir ce qui retient la ligne ${n}`}
            title={offCell.map((alert) => alert.message).join(" ")}
            onClick={() => onUnfoldedChange(true)}
          >
            <TriangleAlert aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-sm:px-2 sheet:max-xl:px-2"
          loading={validating}
          disabled={blocking.length > 0 || unsaved}
          aria-label={`Valider la ligne ${n}`}
          aria-describedby={blocking.length > 0 || unsaved ? summaryId : undefined}
          title="Valider la ligne"
          onClick={async () => {
            setValidating(true);
            await act(onValidate);
            setValidating(false);
          }}
        >
          <Check aria-hidden="true" />
          {/* Where the row is short of room, the mark alone: the word is read on hover and by a screen reader. */}
          <span className="max-sm:sr-only sheet:max-xl:sr-only">Valider</span>
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
