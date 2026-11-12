"use client";

import { useState, type ReactNode } from "react";
import { Check, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { effectiveLineMaterial, type MaterialRequestLineAlert } from "@/lib/material-requests/alerts";
import type { MaterialRequestSupplierOption } from "@/lib/material-requests/client";
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
  CellMessages,
  ChoiceCell,
  ConfirmButton,
  QuantityCell,
  TextCell,
  ToggleCell,
  type CellAlerts,
  type ChoiceOption,
} from "./cells";
import { formatQuantity } from "./format";
import { MaterialRequestArticleCell } from "./MaterialRequestArticleCell";
import { MaterialRequestSupplierCell } from "./MaterialRequestSupplierCell";
import type {
  ArticleNotice,
  LineChangeState,
  LineProposals,
  RetainResult,
  SaveResult,
} from "./useMaterialRequestEditor";

/** The fixed order of the columns (TI-690); the table header and the rows both follow it. */
export const LINE_COLUMNS = [
  { key: "position", label: "N°", width: "w-12" },
  { key: "quantity", label: "Qté", width: "min-w-24" },
  { key: "unit", label: "Unité", width: "min-w-24" },
  { key: "dimension", label: "DN / dimension", width: "min-w-36" },
  { key: "product_type", label: "Type", width: "min-w-56" },
  { key: "material", label: "Matière", width: "min-w-48" },
  { key: "material_precision", label: "Précision / norme", width: "min-w-40" },
  { key: "reference", label: "Référence", width: "min-w-36" },
  { key: "supplier", label: "Fournisseur", width: "min-w-44" },
  { key: "zone", label: "Repère", width: "min-w-32" },
  { key: "imputation", label: "Imputation", width: "min-w-44" },
  { key: "article", label: "Article", width: "min-w-72" },
] as const;

/** Selection column, the columns above, then the status and its actions. */
export const LINE_TABLE_COLUMN_COUNT = LINE_COLUMNS.length + 2;

const IMPUTATION_OPTIONS: ChoiceOption[] = MATERIAL_REQUEST_IMPUTATIONS.map((value) => ({
  value,
  label: MATERIAL_REQUEST_IMPUTATION_LABELS[value],
}));

const CELL = "px-2 py-2 align-top";

type LineRowProps = Readonly<{
  line: MaterialRequestLine;
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
  onLinkArticle: (candidate: MaterialRequestArticleCandidate) => Promise<SaveResult>;
  onUnlinkArticle: () => Promise<SaveResult>;
  onOpenArticles: () => void;
  onRetryProposals: () => void;
  /** The supplier proposed for the line, while it has none (TI-691). */
  supplierProposal: LineSupplierProposal | null;
  /** The article's reference at the line's own supplier, when the catalogue knows it. */
  supplierReference: LineSupplierReference | null;
  onRetainSupplier: (supplierId: string) => Promise<RetainResult>;
}>;

function alertsOf(alerts: readonly MaterialRequestLineAlert[], field: MaterialRequestLineAlert["field"]): CellAlerts {
  return alerts.filter((alert) => alert.field === field);
}

function supplierName(options: readonly MaterialRequestSupplierOption[], id: string | null): string | null {
  if (!id) return null;
  return options.find((option) => option.id === id)?.name ?? "Fournisseur retiré de la liste";
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
    <ul aria-label={`Points à régler, ligne ${position}`} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-warning">
      {alerts.map((alert) => (
        <li key={alert.code} className={cn("font-medium", !alert.blocking && "font-normal italic")}>
          {alert.blocking ? alert.message : `À noter : ${alert.message}`}
        </li>
      ))}
    </ul>
  );
}

function OriginalWording({ text }: Readonly<{ text: string | null }>) {
  if (!text) return null;
  return (
    <p className="min-w-0 text-xs text-muted-foreground">
      Texte du technicien : <span className="font-medium text-foreground">« {text} »</span>
    </p>
  );
}

/** A value shown, not edited: validated lines, and every line for a reader without write access. */
function ReadCell({ children, alerts, id }: Readonly<{ children: ReactNode; alerts?: CellAlerts; id: string }>) {
  return (
    <td className={cn(CELL, "text-sm text-foreground", alerts ? alertCellClass(alerts) : "")}>
      {children || <span className="text-subtle-foreground">—</span>}
      {alerts ? <CellMessages id={id} alerts={alerts} /> : null}
    </td>
  );
}

function ArticleColumn(props: LineRowProps) {
  return (
    <td className={CELL}>
      <MaterialRequestArticleCell
        line={props.line}
        article={props.article}
        canWrite={props.canWrite}
        proposals={props.proposals}
        change={props.change}
        notice={props.articleNotice}
        conflict={props.articleConflict}
        onLink={props.onLinkArticle}
        onUnlink={props.onUnlinkArticle}
        onOpenPanel={props.onOpenArticles}
        onRetryProposals={props.onRetryProposals}
      />
    </td>
  );
}

/**
 * The supplier column, on every row: a supplier is purchasing information, so the office may set or
 * change it on a validated line too, which stays validated.
 */
function SupplierColumn(props: LineRowProps) {
  const { line, request, supplierOptions, canWrite } = props;
  const ownSupplier = supplierName(supplierOptions, line.supplier_id);
  const requestSupplier = supplierFromRequest(request, supplierOptions);
  return (
    <td className={CELL}>
      <MaterialRequestSupplierCell
        line={line}
        editable={canWrite}
        supplierOptions={supplierOptions}
        ownSupplier={ownSupplier}
        requestSupplierLabel={requestSupplier ? fromRequest(requestSupplier) : null}
        proposal={line.supplier_id ? null : props.supplierProposal}
        reference={props.supplierReference}
        supplyTypeName={props.article?.supply_type_name ?? null}
        onSave={props.onSave}
        onRetain={props.onRetainSupplier}
      />
    </td>
  );
}

function SettledLineRow(props: LineRowProps) {
  const { line, alerts, request, canWrite, onReopen } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const validated = line.status === "validated";
  // A settled row says what the line is really ordered in and from whom, as the editable row does:
  // an empty cell here would read as « no material » on the table that was reviewed.
  const ownMaterial = line.material?.trim() ? line.material : null;
  const requestMaterial = ownMaterial ? null : materialFromRequest(line, request);
  const rowId = `material-request-line-${line.id}`;

  return (
    <tbody className={cn("border-b border-border", validated && "bg-success-subtle/60")}>
      <tr>
        <td className={CELL} />
        <td className={cn(CELL, "text-sm font-medium tabular-nums text-muted-foreground")}>{line.position}</td>
        <ReadCell id={`${rowId}-quantity`} alerts={alertsOf(alerts, "quantity")}>
          {line.quantity === null ? null : <span className="tabular-nums">{formatQuantity(line.quantity)}</span>}
        </ReadCell>
        <ReadCell id={`${rowId}-unit`} alerts={alertsOf(alerts, "unit")}>{line.unit}</ReadCell>
        <ReadCell id={`${rowId}-dimension`} alerts={alertsOf(alerts, "dimension")}>
          {line.dimension ?? (line.no_dimension ? "Sans dimension" : null)}
        </ReadCell>
        <ReadCell id={`${rowId}-type`} alerts={alertsOf(alerts, "product_type")}>{line.product_type}</ReadCell>
        <ReadCell id={`${rowId}-material`} alerts={alertsOf(alerts, "material")}>
          {ownMaterial ?? (requestMaterial ? fromRequest(requestMaterial) : null)}
        </ReadCell>
        <ReadCell id={`${rowId}-precision`}>{line.material_precision}</ReadCell>
        <ReadCell id={`${rowId}-reference`}>{line.reference}</ReadCell>
        <SupplierColumn {...props} />
        <ReadCell id={`${rowId}-zone`}>{line.zone}</ReadCell>
        <ReadCell id={`${rowId}-imputation`}>
          {MATERIAL_REQUEST_IMPUTATION_LABELS[line.imputation]}
          {line.imputation === "overhead" && line.overhead_category ? ` · ${line.overhead_category}` : ""}
        </ReadCell>
        <ArticleColumn {...props} />
        <td className={cn(CELL, "whitespace-nowrap")}>
          <div className="flex flex-wrap items-center gap-2">
            {validated ? (
              <Badge variant="success">
                <Check aria-hidden="true" />
                Validée
              </Badge>
            ) : (
              <Badge variant="neutral">Brouillon</Badge>
            )}
            {validated && canWrite ? (
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
        </td>
      </tr>
      {line.original_text || line.quantity_doubtful || alerts.length > 0 || error ? (
        <tr>
          <td />
          <td colSpan={LINE_TABLE_COLUMN_COUNT - 1} className="px-2 pb-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <OriginalWording text={line.original_text} />
              <AlertSummary position={line.position} alerts={alerts} />
              {error ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </tbody>
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
  // A change the server refused is still in its cell: validating now would validate the older value.
  const unsaved = change === "failed";

  const act = async (action: () => Promise<SaveResult>) => {
    const result = await action();
    setError(result.ok || result.blocked ? null : result.message);
    return result;
  };
  const cell = (field: MaterialRequestLineAlert["field"]) => cn(CELL, alertCellClass(alertsOf(alerts, field)));

  return (
    <tbody className={cn("border-b border-border", selected && "bg-primary/5")}>
      <tr>
        <td className={cn(CELL, "pt-4")}>
          <input
            type="checkbox"
            className="size-4 accent-primary"
            aria-label={`Sélectionner la ligne ${n}`}
            checked={selected}
            onChange={(event) => onSelectedChange(event.currentTarget.checked)}
          />
        </td>
        <td className={cn(CELL, "pt-4 text-sm font-medium tabular-nums text-muted-foreground")}>{n}</td>
        <td className={cell("quantity")}>
          <QuantityCell
            label={`Quantité, ligne ${n}`}
            value={line.quantity}
            alerts={alertsOf(alerts, "quantity")}
            onCommit={(quantity) => onSave({ quantity })}
            onAbandon={() => onForget(["quantity"])}
          />
        </td>
        <td className={cell("unit")}>
          <TextCell
            label={`Unité, ligne ${n}`}
            value={line.unit}
            list={unitListId}
            maxLength={20}
            alerts={alertsOf(alerts, "unit")}
            onCommit={(unit) => onSave({ unit })}
            onAbandon={() => onForget(["unit"])}
          />
        </td>
        <td className={cell("dimension")}>
          <TextCell
            label={`DN / dimension, ligne ${n}`}
            value={line.dimension}
            maxLength={80}
            placeholder={line.no_dimension ? "Sans dimension" : undefined}
            alerts={alertsOf(alerts, "dimension")}
            onCommit={(dimension) => onSave({ dimension })}
            onAbandon={() => onForget(["dimension"])}
          />
        </td>
        <td className={cell("product_type")}>
          <TextCell
            label={`Type, ligne ${n}`}
            value={line.product_type}
            maxLength={200}
            alerts={alertsOf(alerts, "product_type")}
            onCommit={(product_type) => onSave({ product_type })}
            onAbandon={() => onForget(["product_type"])}
          />
        </td>
        <td className={cell("material")}>
          <TextCell
            label={`Matière, ligne ${n}`}
            value={line.material}
            list={materialListId}
            maxLength={120}
            placeholder={requestMaterial ? fromRequest(requestMaterial) : undefined}
            alerts={alertsOf(alerts, "material")}
            onCommit={(material) => onSave({ material })}
            onAbandon={() => onForget(["material"])}
          />
        </td>
        <td className={CELL}>
          <TextCell
            label={`Précision / norme, ligne ${n}`}
            value={line.material_precision}
            maxLength={120}
            onCommit={(material_precision) => onSave({ material_precision })}
            onAbandon={() => onForget(["material_precision"])}
          />
        </td>
        <td className={CELL}>
          <TextCell
            label={`Référence, ligne ${n}`}
            value={line.reference}
            maxLength={120}
            onCommit={(reference) => onSave({ reference })}
            onAbandon={() => onForget(["reference"])}
          />
        </td>
        <SupplierColumn {...props} />
        <td className={CELL}>
          <TextCell
            label={`Repère, ligne ${n}`}
            value={line.zone}
            maxLength={80}
            onCommit={(zone) => onSave({ zone })}
            onAbandon={() => onForget(["zone"])}
          />
        </td>
        <td className={CELL}>
          <ChoiceCell
            label={`Imputation, ligne ${n}`}
            value={line.imputation}
            options={IMPUTATION_OPTIONS}
            onCommit={(next) => {
              const imputation = (next ?? "project") as MaterialRequestImputation;
              return onSave(imputation === "project" ? { imputation, overhead_category: null } : { imputation });
            }}
          />
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
        </td>
        <ArticleColumn {...props} />
        <td className={cn(CELL, "whitespace-nowrap")}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">Brouillon</Badge>
            {blocking.length > 0 ? <Badge variant="warning">{blocking.length} à régler</Badge> : null}
          </div>
          <div className="mt-2 flex items-center gap-1">
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
        </td>
      </tr>
      <tr>
        <td />
        <td colSpan={LINE_TABLE_COLUMN_COUNT - 1} className="px-2 pb-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <OriginalWording text={line.original_text} />
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
            <div id={summaryId} className="min-w-0">
              <AlertSummary position={n} alerts={alerts} />
              {unsaved ? (
                <p className="text-xs font-medium text-danger">
                  Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être validée en l’état.
                </p>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

/** One line of the request: edited in place while it is a draft, settled once validated. */
export function MaterialRequestLineRow(props: LineRowProps) {
  return props.line.status === "validated" || !props.canWrite ? (
    <SettledLineRow {...props} />
  ) : (
    <EditableLineRow {...props} />
  );
}
