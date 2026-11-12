"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import {
  type EstimateItem,
  type ItemPatch,
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
  formatNumberDisplay,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";
import type { SpreadsheetCellProps, SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";
import type { EstimateV3LineResult } from "@/lib/estimates/engine-v3";
import {
  ESTIMATE_V3_PRICING_STATUS_OPTIONS,
  findEstimateV3Line,
  formatEstimateV3TaxRate,
  formatEstimateV3UnitLabel,
  isEstimateV3PricingStatus,
  readEstimateV3LineMargin,
  resolveEstimateV3TaxRateOptions,
  resolveEstimateV3UnitInput,
  type EstimateV3LineIndex,
} from "@/lib/estimates/v3-editor";
import { parseHoursPerUnit } from "@/lib/numeric-input/parsers";
import {
  asksStatusReason,
  isExcludedAfterNotPriced,
  readEstimateStatusReason,
  requiresStatusReason,
  type EstimateStatusReason,
} from "@/lib/estimates/status-reason";
import { V3StatusReasonDialog } from "@/components/estimates/v3/V3StatusReasonDialog";
import { V3OfferProvisionalQuantityDialog } from "@/components/estimates/v3/V3OfferProvisionalQuantityDialog";
import { V3OfferReserveDialog } from "@/components/estimates/v3/V3OfferReserveDialog";
import { readOfferProvisionalQuantity, readOfferReserve, type EstimateOfferChoiceInput } from "@/lib/estimates/offer-choice";
import { readTakeoffProvision } from "@/lib/estimates/takeoff-provision";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";

/**
 * Lot 2, sous-lot 2.6 - cellules v3 de la grille (conception D4, D8, D9 ; contrat d'écran §9.4.2 de
 * docs/testing/estimate-engine-v3-2.6.md). `LineRow`, `StandardMoCells` et `EstimateEditorRow`
 * délèguent ici quand l'éditeur est ouvert sur une v3 (contexte fourni par `EstimateEditorPage`) ;
 * sans contexte (v1/v2), rien ne change. Aucun montant n'est calculé : PU, PT et heures totales
 * viennent de l'aperçu du moteur pur ; les cellules n'écrivent que des saisies (`unit_code`,
 * `pricing_status`, `h_mo_per_unit`, `tax_rate_bp`), jamais `h_mo` ni une projection.
 */

export type EstimateV3GridModel = {
  /** Lignes calculées par le moteur pur pour l'aperçu courant (vide si l'aperçu est refusé). */
  lines: EstimateV3LineIndex;
  allowedTaxRatesBp: readonly number[];
  /**
   * TI-682, lot C, PR 4: the written reserve of a « Non chiffrée » line. `canDeclare`: a tenant administrator who may
   * write this draft; `save` writes it through the administration route (null withdraws it). Absent: read only.
   */
  offerReserve?: {
    canDeclare: boolean;
    save: (itemId: string, choice: EstimateOfferChoiceInput | null) => Promise<void>;
    /** PR 5: what « Établie sur » of a provisional quantity starts from (the takeoff line's note), or null. */
    suggestEstablishedOn?: (itemId: string) => Promise<string | null>;
  };
  /** Coefficient de vente FO de l'aperçu courant, pour le détail du coût de fourniture d'une ligne (TI-541). */
  saleCoefficientFo?: string | null;
};

const EstimateV3GridContext = createContext<EstimateV3GridModel | null>(null);
const UNIT_OPTIONS_ID = "estimate-v3-unit-options";

/**
 * TI-682, lot C : demande du motif interne d'une ligne. La fenêtre vit au niveau de la grille, pas dans la ligne : en
 * grille compacte, le statut se choisit dans le menu « Details de la ligne », qui se ferme (et se démonte) dès que la
 * fenêtre prend le focus.
 */
type StatusReasonRequest = {
  title: string;
  statusLabel: string;
  reason: unknown;
  isReadOnly: boolean;
  save: (reason: EstimateStatusReason) => void;
};
const StatusReasonRequestContext = createContext<((request: StatusReasonRequest) => void) | null>(null);

/**
 * TI-682, lot C, PR 4 : la réserve écrite d'une ligne, ouverte au niveau de la grille pour la même raison. PR 5 : la
 * quantité provisionnelle d'une ligne chiffrée sur hypothèse, avec ce qu'il faut pour écrire sa phrase.
 */
type OfferReserveRequest = {
  kind: "reserve" | "provisional_quantity";
  itemId: string;
  title: string;
  choice: unknown;
  canDeclare: boolean;
  quantity?: number | string | null;
  unit_code?: string | null;
};
const OfferReserveRequestContext = createContext<((request: OfferReserveRequest) => void) | null>(null);

export function EstimateV3GridProvider({ value, children }: { value: EstimateV3GridModel | null; children: ReactNode }) {
  const [statusReasonRequest, setStatusReasonRequest] = useState<StatusReasonRequest | null>(null);
  const [offerReserveRequest, setOfferReserveRequest] = useState<OfferReserveRequest | null>(null);
  const saveOfferReserve = value?.offerReserve?.save;
  const suggestEstablishedOn = value?.offerReserve?.suggestEstablishedOn;
  return (
    <EstimateV3GridContext.Provider value={value}>
      <OfferReserveRequestContext.Provider value={setOfferReserveRequest}>
      <StatusReasonRequestContext.Provider value={setStatusReasonRequest}>
        {children}
        {value ? (
          <>
            <datalist id={UNIT_OPTIONS_ID}>
              {MEASUREMENT_UNITS.filter((unit) => unit.active).map((unit) => (
                <option key={unit.code} value={formatEstimateV3UnitLabel(unit.code)} />
              ))}
            </datalist>
            <V3StatusReasonDialog
              line={statusReasonRequest}
              isReadOnly={statusReasonRequest?.isReadOnly ?? true}
              onClose={() => setStatusReasonRequest(null)}
              onSave={(reason) => {
                statusReasonRequest?.save(reason);
                setStatusReasonRequest(null);
              }}
            />
            <V3OfferReserveDialog
              line={offerReserveRequest?.kind === "reserve" ? offerReserveRequest : null}
              canDeclare={Boolean(offerReserveRequest?.canDeclare && saveOfferReserve)}
              onClose={() => setOfferReserveRequest(null)}
              onSave={async (choice) => {
                if (!offerReserveRequest || !saveOfferReserve) return;
                await saveOfferReserve(offerReserveRequest.itemId, choice);
                setOfferReserveRequest(null);
              }}
            />
            <V3OfferProvisionalQuantityDialog
              line={offerReserveRequest?.kind === "provisional_quantity" ? offerReserveRequest : null}
              canDeclare={Boolean(offerReserveRequest?.canDeclare && saveOfferReserve)}
              suggestEstablishedOn={offerReserveRequest && suggestEstablishedOn
                ? () => suggestEstablishedOn(offerReserveRequest.itemId) : undefined}
              onClose={() => setOfferReserveRequest(null)}
              onSave={async (choice) => {
                if (!offerReserveRequest || !saveOfferReserve) return;
                await saveOfferReserve(offerReserveRequest.itemId, choice);
                setOfferReserveRequest(null);
              }}
            />
          </>
        ) : null}
      </StatusReasonRequestContext.Provider>
      </OfferReserveRequestContext.Provider>
    </EstimateV3GridContext.Provider>
  );
}

/** Modèle v3 de la grille, ou nul pour une v1/v2 (cellules historiques). */
export function useEstimateV3Grid(): EstimateV3GridModel | null {
  return useContext(EstimateV3GridContext);
}

/** Ligne calculée par le moteur pour un élément de la grille, ou nulle. */
export function useEstimateV3Line(itemId: string): EstimateV3LineResult | null {
  const grid = useEstimateV3Grid();
  return grid ? findEstimateV3Line(grid.lines, itemId) : null;
}

/**
 * « Deboursé sec », « Marge € », « Marque % » d'une ligne v3, lus dans le moteur (revue de 2.6, F26-24) : jamais la
 * formule v1/v2 de `computeEstimateLineMargin`, qui prenait le net comme vente et les taux atelier/chantier du rôle.
 */
export function readEstimateV3GridLineMargin(grid: EstimateV3GridModel, itemId: string) {
  return readEstimateV3LineMargin(findEstimateV3Line(grid.lines, itemId));
}

/**
 * Unités des lignes lues hors de la cellule « U » (copie vers le presse-papiers) : sur une v3, le code du référentiel
 * `unit_code`, jamais `description` (vide sur une ligne faite par la grille) ; v1/v2 : les brouillons d'unité.
 */
export function useEstimateV3UnitDrafts(
  items: ReadonlyArray<Pick<EstimateItem, "id" | "item_type" | "unit_code">>,
  historicalDrafts: Record<string, string>
): Record<string, string> {
  const grid = useEstimateV3Grid();
  return useMemo(() => (grid
    ? Object.fromEntries(items.filter((item) => item.item_type === "line").map((item) => [item.id, item.unit_code ?? ""]))
    : historicalDrafts), [grid, historicalDrafts, items]);
}

type PatchItem = (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void;

function lineLabel(item: Pick<EstimateItem, "title">) {
  return item.title || "sans titre";
}

/**
 * Cellule « U » (référentiel, D9) : un alias unique validé à la sortie du champ (« ML » → ml),
 * affiché « ml — mètre linéaire ». Une saisie inconnue reste visible, refusée par son message
 * (cellule signalée, `aria-invalid`, message dans l'infobulle et pour les lecteurs d'écran), sans
 * écriture ; la cellule se quitte (revue de 2.6, F26-10 : `reportValidity()` y ramenait le focus et
 * Tab ne sortait plus de la cellule). Vider le champ retire l'unité (brouillon incomplet admis).
 */
export function V3UnitCell({
  cell,
  cellProps,
  editorProps,
  navigation,
  item,
  isReadOnly,
  onPatchItem,
}: {
  cell: SpreadsheetCell;
  cellProps: SpreadsheetCellProps;
  editorProps: SpreadsheetEditorProps<HTMLInputElement>;
  navigation: SpreadsheetNavigationResult;
  item: EstimateItem;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayed = formatEstimateV3UnitLabel(item.unit_code);
  const value = draft ?? displayed;
  const errorId = `${cell.rowId}-v3-unit-error`;
  // Au repos la colonne étroite montre le code (« ml ») ; le champ garde le libellé complet,
  // lu par les lecteurs d'écran et affiché dès qu'il a le focus.
  const showsUnitCode = draft === null && !error && Boolean(item.unit_code);

  return (
    <div
      {...cellProps}
      data-estimate-column="unit"
      role="gridcell"
      onKeyDown={toCellKeyDownHandler(cellProps.onKeyDown)}
      className={toCellClassName(
        navigation,
        cell,
        `estimate-cell${!value.trim() || error ? " estimate-cell--required-empty" : ""}${
          showsUnitCode ? " estimate-cell--unit-coded" : ""
        }`,
      )}
    >
      <input
        className="estimate-input"
        ref={editorProps.ref}
        tabIndex={editorProps.tabIndex}
        list={UNIT_OPTIONS_ID}
        value={value}
        title={error ?? (displayed || undefined)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={editorProps.onFocus}
        onKeyDown={editorProps.onKeyDown}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          event.currentTarget.setCustomValidity("");
        }}
        onBlur={(event) => {
          editorProps.onBlur(event);
          // La valeur du champ fait foi : Échap la restaure juste avant de quitter la cellule,
          // avant que le brouillon React ne soit rendu.
          const raw = event.currentTarget.value;
          if (draft === null && raw === displayed) return;
          if (raw === displayed) {
            setDraft(null);
            setError(null);
            event.currentTarget.setCustomValidity("");
            return;
          }
          const resolution = resolveEstimateV3UnitInput(raw, item.unit_code);
          if (resolution.kind === "invalid") {
            setError(resolution.message);
            event.currentTarget.setCustomValidity(resolution.message);
            return;
          }
          setDraft(null);
          if (resolution.kind === "unit" && resolution.unitCode !== (item.unit_code ?? null)) {
            onPatchItem(item.id, { unit_code: resolution.unitCode }, { persist: true });
          }
        }}
        placeholder="Obligatoire"
        aria-label={`Unité pour ${lineLabel(item)}`}
        disabled={isReadOnly}
      />
      {showsUnitCode ? (
        <span className="estimate-unit-code" aria-hidden="true">
          {item.unit_code}
        </span>
      ) : null}
      {error ? <span id={errorId} className="sr-only">{error}</span> : null}
    </div>
  );
}

/**
 * Lot 2, sous-lot 2.6b (A13, D-c) : unité d'une ligne v3 hors de la grille (éditeur mobile). Même règle que la
 * cellule « U » : un alias du référentiel résolu à la sortie du champ et écrit dans `unit_code`, une saisie inconnue
 * refusée par son message, visible, sans écriture ; jamais `description`.
 */
export function V3UnitField({
  item,
  className,
  isReadOnly,
  onPatchItem,
}: {
  item: EstimateItem;
  className: string;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? formatEstimateV3UnitLabel(item.unit_code);
  const errorId = `${item.id}-v3-unit-field-error`;
  return (
    <>
      <input
        className={className}
        list={UNIT_OPTIONS_ID}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (draft === null) return;
          const resolution = resolveEstimateV3UnitInput(draft, item.unit_code);
          if (resolution.kind === "invalid") {
            setError(resolution.message);
            return;
          }
          setDraft(null);
          if (resolution.kind === "unit" && resolution.unitCode !== (item.unit_code ?? null)) {
            onPatchItem(item.id, { unit_code: resolution.unitCode }, { persist: true });
          }
        }}
        placeholder="Obligatoire"
        aria-label={`Unité pour ${lineLabel(item)}`}
        disabled={isReadOnly}
      />
      {error ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </>
  );
}

const HOURS_FORMAT = { minDecimals: 0, maxDecimals: 3 } as const;

/** Heures totales d'une ligne v3 telles que le moteur les dérive (Q × h/u), sinon celles de la ligne relue. */
export function useEstimateV3LineTotalHours(item: Pick<EstimateItem, "id" | "h_mo">): number | null {
  const line = useEstimateV3Line(item.id);
  return line ? (line.h_mo === null ? null : Number(line.h_mo)) : item.h_mo;
}

export function formatEstimateV3Hours(hours: number | null) {
  return formatNumberDisplay(hours ?? 0, HOURS_FORMAT);
}

/**
 * Contenu de la cellule « h MO » d'une v3 : heures **par unité** saisies (D4, 4 décimales,
 * `h_mo_per_unit`) et, en lecture seule, les heures totales de la ligne Q × h/u telles que le
 * moteur les dérive. La cellule n'écrit jamais `h_mo`.
 */
export function V3LaborHoursCellContent({
  item,
  editorProps,
  isReadOnly,
  onPatchItem,
}: {
  item: EstimateItem;
  editorProps: SpreadsheetEditorProps<HTMLInputElement>;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const totalHours = useEstimateV3LineTotalHours(item);
  return (
    <div className="estimate-hours-stack flex min-w-0 flex-col items-stretch">
      <DecimalDraftInput
        className="estimate-input estimate-input--compact-number"
        ref={editorProps.ref}
        tabIndex={editorProps.tabIndex}
        value={item.h_mo_per_unit ?? null}
        emptyValue={0}
        parseValue={parseHoursPerUnit}
        aria-label={`Heures de main-d’œuvre par unité pour ${lineLabel(item)}`}
        title="Heures de main-d’œuvre par unité : la quantité les multiplie (h MO total = Qté × h MO / u)."
        onFocus={editorProps.onFocus}
        onKeyDown={editorProps.onKeyDown}
        onValueChange={(value) => onPatchItem(item.id, { h_mo_per_unit: value }, { persist: false })}
        onBlur={editorProps.onBlur}
        onValueCommit={(value) => onPatchItem(item.id, { h_mo_per_unit: value }, { persist: true })}
        placeholder="0"
        disabled={isReadOnly}
      />
      <span className="estimate-hours-stack__sum flex items-baseline justify-end gap-0.5 text-micro text-muted-foreground" title="Total d'heures de la ligne : Qté × h MO / u">
        <span aria-hidden="true">Σ</span>
        <output aria-label={`Heures de main-d’œuvre totales pour ${lineLabel(item)}`} className="tabular-nums">
          {formatEstimateV3Hours(totalHours)}
        </output>
      </span>
    </div>
  );
}

/**
 * Statut de chiffrage (D9) et taux de TVA de ligne (D8) d'une v3, sous la désignation. Une ligne
 * non chiffrée garde ses saisies (Q, PR, h/u) ; le moteur l'exclut du HT et de la TVA.
 * TI-682, lot C : une ligne non chiffrée (ou qui l'a été) passée Inclus, Pour mémoire, Hors lot ou Sans objet demande
 * son motif interne. Le statut s'enregistre de toute façon ; seul l'envoi attend le motif.
 */
export function V3LineStateControls({
  item,
  isReadOnly,
  onPatchItem,
}: {
  item: EstimateItem;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const status = isEstimateV3PricingStatus(item.pricing_status) ? item.pricing_status : "priced";
  const allowedRates = useEstimateV3Grid()?.allowedTaxRatesBp ?? [];
  const taxRates = resolveEstimateV3TaxRateOptions(allowedRates, item.tax_rate_bp);
  const requestStatusReason = useContext(StatusReasonRequestContext);
  const labelOf = (value: string) => ESTIMATE_V3_PRICING_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
  const openReason = (nextStatus: string) => requestStatusReason?.({
    title: lineLabel(item), statusLabel: labelOf(nextStatus), reason: item.status_reason, isReadOnly,
    save: (reason) => onPatchItem(item.id, { status_reason: reason }, { persist: true }),
  });
  const showsReason = isExcludedAfterNotPriced(item);
  const missingReason = requiresStatusReason(item);
  // TI-682, lot C, PR 4 : réserve écrite d'une ligne « Non chiffrée » (déclarée par un administrateur, lue par tous).
  const requestOfferReserve = useContext(OfferReserveRequestContext);
  const canDeclareReserve = Boolean(useEstimateV3Grid()?.offerReserve?.canDeclare) && !isReadOnly;
  const reserve = readOfferReserve(item);
  const showsReserve = status === "not_priced" && (reserve !== null || canDeclareReserve);
  // PR 5 : une ligne chiffrée dont la quantité repose sur une hypothèse du métré peut annoncer une quantité provisionnelle.
  const provisional = readOfferProvisionalQuantity(item);
  const isHypothesis = readTakeoffProvision(item.source_metadata)?.kind === "hypothesis";
  const showsProvisional = status === "priced" && (provisional !== null || (isHypothesis && canDeclareReserve));
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-testid="estimate-v3-line-state">
      <select
        className="estimate-input h-6 w-auto py-0 text-xs"
        aria-label={`Statut de chiffrage pour ${lineLabel(item)}`}
        value={status}
        disabled={isReadOnly}
        onChange={(event) => {
          const next = event.target.value;
          if (!isEstimateV3PricingStatus(next)) return;
          onPatchItem(item.id, { pricing_status: next }, { persist: true });
          // Asked once: a line moving between excluded statuses keeps the reason it already has.
          if (asksStatusReason(item, next) && readEstimateStatusReason(item.status_reason) === null) openReason(next);
        }}
      >
        {ESTIMATE_V3_PRICING_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {showsReason ? (
        <button
          type="button"
          className={missingReason
            ? "shrink-0 whitespace-nowrap rounded border border-warning-border bg-warning-subtle px-1.5 text-xs text-warning"
            : "shrink-0 whitespace-nowrap rounded border border-border px-1.5 text-xs text-muted-foreground hover:text-foreground"}
          aria-label={`${missingReason ? "Motif interne à saisir" : "Motif interne"} pour ${lineLabel(item)}`}
          title={missingReason ? "Motif interne à saisir avant l'envoi (jamais transmis au client)" : "Motif interne (jamais transmis au client)"}
          onClick={() => openReason(status)}
        >
          {missingReason ? "Motif à saisir" : "Motif"}
        </button>
      ) : null}
      {showsReserve ? (
        <button
          type="button"
          className={reserve
            ? "shrink-0 whitespace-nowrap rounded border border-info-border bg-info-subtle px-1.5 text-xs text-info"
            : "shrink-0 whitespace-nowrap rounded border border-border px-1.5 text-xs text-muted-foreground hover:text-foreground"}
          aria-label={`${reserve ? "Réserve déclarée" : "Déclarer une réserve"} pour ${lineLabel(item)}`}
          title={reserve
            ? "Réserve écrite dans l'offre : la ligne part « Non chiffrée », les précisions le disent"
            : "Déclarer une réserve écrite : la ligne part « Non chiffrée » et l'offre le dit (administrateur)"}
          onClick={() => requestOfferReserve?.({ kind: "reserve", itemId: item.id, title: lineLabel(item),
            choice: item.offer_choice ?? null, canDeclare: canDeclareReserve })}
        >
          {reserve ? "Réservée" : "Réserve"}
        </button>
      ) : null}
      {showsProvisional ? (
        <button
          type="button"
          className={provisional
            ? "shrink-0 whitespace-nowrap rounded border border-info-border bg-info-subtle px-1.5 text-xs text-info"
            : "shrink-0 whitespace-nowrap rounded border border-border px-1.5 text-xs text-muted-foreground hover:text-foreground"}
          aria-label={`${provisional ? "Quantité provisionnelle déclarée" : "Déclarer une quantité provisionnelle"} pour ${lineLabel(item)}`}
          title={provisional
            ? "Quantité provisionnelle : la ligne part chiffrée, les précisions disent sur quoi sa quantité est établie"
            : "La quantité repose sur une hypothèse du métré : déclarer une quantité provisionnelle (administrateur)"}
          onClick={() => requestOfferReserve?.({ kind: "provisional_quantity", itemId: item.id, title: lineLabel(item),
            choice: item.offer_choice ?? null, canDeclare: canDeclareReserve, quantity: item.quantity, unit_code: item.unit_code })}
        >
          {provisional ? "Q. prov." : "Hypothèse"}
        </button>
      ) : null}
      <select
        className="estimate-input h-6 w-auto py-0 text-xs"
        aria-label={`Taux de TVA pour ${lineLabel(item)}`}
        value={item.tax_rate_bp === null ? "" : String(item.tax_rate_bp)}
        disabled={isReadOnly}
        onChange={(event) => {
          const rateBp = Number(event.target.value);
          if (!Number.isInteger(rateBp)) return;
          onPatchItem(item.id, { tax_rate_bp: rateBp }, { persist: true });
        }}
      >
        {item.tax_rate_bp === null ? <option value="">TVA</option> : null}
        {taxRates.map((rateBp) => {
          const retired = !allowedRates.includes(rateBp);
          return (
            <option key={rateBp} value={String(rateBp)} disabled={retired}>
              {`TVA ${formatEstimateV3TaxRate(rateBp)} %${retired && !isReadOnly ? " (retiré)" : ""}`}
            </option>
          );
        })}
      </select>
    </span>
  );
}
