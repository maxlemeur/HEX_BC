"use client";

import { useState } from "react";

import type { ImportFlowLinesPreview } from "@/app/dashboard/affaires/_actions/import-flow";
import type { InvalidImportFlowLineReason } from "@/lib/affaires/import-flow";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDecimalInput, parseCoefficient } from "@/lib/numeric-input/parsers";

const decimalFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const centsFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatDecimal(value: number | null | undefined) {
  return typeof value === "number" ? decimalFormatter.format(value) : "—";
}

function formatEurosFromCents(cents: number) {
  return `${centsFormatter.format(cents / 100)} €`;
}

const INVALID_REASON_LABELS: Record<InvalidImportFlowLineReason, string> = {
  missing_title: "sans désignation",
  invalid_quantity: "quantité invalide (trois décimales au plus)",
  invalid_unit_price: "prix invalide (deux décimales au plus)",
  invalid_tax_rate: "taux de TVA invalide",
  invalid_coefficient: "coefficient invalide (quatre décimales au plus)",
  invalid_labor_hours: "heures invalides (heures par unité : quatre décimales au plus)",
  conflicting_labor_hours: "heures de ligne et heures par unité renseignées ensemble",
  invalid_majoration: "majoration invalide (format refusé ou coefficient hors [0 ; 10])",
  undeclared_majoration_unit:
    "majoration sans unité déclarée : choisissez « Majoration MO (%) », « (coefficient) » ou « additive OPTIMA » dans le mapping",
  preview_required: "heures par unité ou paramètres de classeur à vérifier dans l’aperçu",
  line_hours_require_hours_per_unit:
    "heures de ligne : un chiffrage moteur 3 porte des heures par unité, choisissez « Heures MO par unité » dans le mapping",
  invalid_row_payload: "ligne illisible",
};

export const LABOR_ROLE_SELECT_LABEL = "Rôle MO des heures importées";
// Explicit « no role » choice, sent as null (E17); "" is the unanswered placeholder.
export const NO_LABOR_ROLE_OPTION_VALUE = "none";

export type ImportSaleCoefficientsChoice = { fo: number; mo: number };

type ImportLinesPreviewProps = {
  preview: ImportFlowLinesPreview | null;
  isLoading: boolean;
  error: string | null;
  selectedLaborRoleId: string | null | undefined;
  onLaborRoleChange: (roleId: string | null) => void;
  // Sub-lot 2.8 (E4): the v3 sale coefficients proposed by the preview, modifiable before confirmation.
  onSaleCoefficientsChange?: (coefficients: ImportSaleCoefficientsChoice) => void;
  onRetry: () => void;
};

function readSaleCoefficient(text: string): number | null {
  const value = parseCoefficient(text);
  return value !== null && value > 0 && value <= 10 ? value : null;
}

/**
 * Sale coefficients of the v3 the import creates (sub-lot 2.8, D5): proposed from the workbook
 * parameter row, or the company's; a valid change re-prices the preview.
 */
function SaleCoefficientsFields({
  coefficients,
  onChange,
}: {
  coefficients: ImportSaleCoefficientsChoice;
  onChange?: (coefficients: ImportSaleCoefficientsChoice) => void;
}) {
  const [fo, setFo] = useState(() => formatDecimalInput(coefficients.fo));
  const [mo, setMo] = useState(() => formatDecimalInput(coefficients.mo));
  const parsedFo = readSaleCoefficient(fo);
  const parsedMo = readSaleCoefficient(mo);
  const commit = () => {
    if (parsedFo === null || parsedMo === null) return;
    if (parsedFo === coefficients.fo && parsedMo === coefficients.mo) return;
    onChange?.({ fo: parsedFo, mo: parsedMo });
  };
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3">
      {([
        ["import-sale-coefficient-fo", "Coefficient de vente FO", fo, setFo, parsedFo],
        ["import-sale-coefficient-mo", "Coefficient de vente MO", mo, setMo, parsedMo],
      ] as const).map(([id, label, value, setValue, parsed]) => (
        <div key={id} className="space-y-1">
          <label htmlFor={id} className="text-xs font-semibold text-foreground">
            {label}
          </label>
          <Input
            id={id}
            size="sm"
            inputMode="decimal"
            className="w-28"
            value={value}
            aria-invalid={parsed === null || undefined}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
        </div>
      ))}
      {parsedFo === null || parsedMo === null ? (
        <p className="text-xs text-danger" role="alert">
          Coefficient de vente : nombre positif jusqu’à 10, quatre décimales au plus.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Import preview of what the estimate lines receive (sub-lot 2.3): v1/v2 store the line's total
 * hours, so hours per unit are converted as h/u × Q (P-16); the workbook parameters and the labour
 * role of the hours are shown before confirmation (E17), with the self-check against the
 * workbook's sale unit price (D11) and the refused lines with their reason.
 */
export function ImportLinesPreview({
  preview,
  isLoading,
  error,
  selectedLaborRoleId,
  onLaborRoleChange,
  onSaleCoefficientsChange,
  onRetry,
}: ImportLinesPreviewProps) {
  if (error) {
    return (
      <Alert variant="danger">
        <AlertTitle>Aperçu des lignes indisponible</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-danger">
          <span>{error}</span>
          <Button variant="link" size="sm" className="text-danger" onClick={onRetry}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !preview) {
    return (
      <div
        className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground shadow-card"
        role="status"
      >
        Calcul de l’aperçu des heures et des contrôles…
      </div>
    );
  }

  const { hours, workbookParameters, laborRole, unitPriceChecks, saleCoefficients } = preview;
  const isV3 = preview.engine === 3;
  const hasHours = hours.lines.length > 0;
  const invalidByReason = preview.invalidLines.reduce<Map<InvalidImportFlowLineReason, number[]>>(
    (groups, line) => {
      const rows = groups.get(line.reason) ?? [];
      rows.push(line.rowIndex + 1);
      groups.set(line.reason, rows);
      return groups;
    },
    new Map()
  );
  const roleChoiceRequired = laborRole.status === "choice_required";
  const roleSelectValue =
    selectedLaborRoleId === null
      ? NO_LABOR_ROLE_OPTION_VALUE
      : (selectedLaborRoleId ?? laborRole.roleId ?? (roleChoiceRequired ? "" : NO_LABOR_ROLE_OPTION_VALUE));
  const workbookCoefficients = [workbookParameters?.coeffFo, workbookParameters?.coeffMo].filter(
    (value): value is number => typeof value === "number"
  );
  const coefficientsDiffer = workbookCoefficients.some(
    (value) => Math.abs(value - preview.versionMarginMultiplier) > 1e-9
  );

  const perUnitDurations = preview.perUnitDurationsAsLineHours;

  if (
    !isV3 &&
    !hasHours &&
    !workbookParameters &&
    preview.invalidLineCount === 0 &&
    unitPriceChecks.checked === 0 &&
    perUnitDurations.length === 0
  ) {
    return null;
  }

  return (
    <section
      aria-labelledby="import-lines-preview-title"
      className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6"
      data-testid="import-lines-preview"
    >
      <div>
        <h2 id="import-lines-preview-title" className="text-sm font-semibold text-foreground">
          Lignes importées : heures, paramètres et contrôles
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {preview.validLineCount} ligne{preview.validLineCount > 1 ? "s" : ""} prête
          {preview.validLineCount > 1 ? "s" : ""}
          {preview.ignoredParameterRows > 0
            ? ` · ${preview.ignoredParameterRows} ligne de paramètres lue, non importée`
            : ""}
          {preview.invalidLineCount > 0 ? ` · ${preview.invalidLineCount} refusée${preview.invalidLineCount > 1 ? "s" : ""}` : ""}
        </p>
      </div>

      {perUnitDurations.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Durée par unité lue comme heures de ligne</AlertTitle>
          <AlertDescription>
            {perUnitDurations.map((column) => `« ${column} »`).join(", ")}{" "}
            {perUnitDurations.length > 1 ? "nomment" : "nomme"} une durée par unité, mais la correspondance{" "}
            {perUnitDurations.length > 1 ? "les lit" : "la lit"} comme heures totales de la ligne. Si c’est une
            durée par unité, choisissez « Heures MO par unité (h/u × Q) » dans le mapping.
          </AlertDescription>
        </Alert>
      ) : null}

      {hasHours ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
            {isV3
              ? "Heures MO : heures par unité (h/u)"
              : hours.convertedLines > 0
                ? "Heures MO : h/u × Q = heures totales de la ligne"
                : "Heures MO : heures totales de la ligne"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isV3
              ? "Ce devis (moteur 3) stocke les heures par unité du fichier ; les heures de ligne en découlent (h/u × Q, au millième d’heure) et suivent la quantité."
              : hours.convertedLines > 0
                ? "Ce devis stocke les heures totales de chaque ligne. Les heures par unité du fichier sont multipliées par la quantité (h/u × Q), arrondies au millième d’heure ; elles suivent la quantité à l’import seulement."
                : "La colonne importée est lue comme les heures totales de la ligne, qui ne varient pas avec la quantité."}
            {` Total : ${formatDecimal(hours.totalLineHours)} h sur ${hours.linesWithHours} ligne${hours.linesWithHours > 1 ? "s" : ""}.`}
          </p>
          <div className="table-scroll overflow-x-auto" role="region" aria-label="Heures MO importées" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Désignation</th>
                  <th scope="col">Q</th>
                  {hours.convertedLines > 0 ? <th scope="col">h/u</th> : null}
                  <th scope="col">Heures de ligne</th>
                </tr>
              </thead>
              <tbody>
                {hours.lines.map((line) => (
                  <tr key={line.rowIndex}>
                    <td>{line.rowIndex + 1}</td>
                    <td>{line.title}</td>
                    <td>{formatDecimal(line.quantity)}</td>
                    {hours.convertedLines > 0 ? <td>{formatDecimal(line.hoursPerUnit)}</td> : null}
                    <td>{formatDecimal(line.lineHours)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {workbookParameters ? (
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-xs text-foreground-secondary">
          <p className="font-medium text-foreground">
            Paramètres du classeur (ligne {workbookParameters.rowIndex + 1}, non importée)
          </p>
          <p className="mt-1">
            Coeff FO {formatDecimal(workbookParameters.coeffFo)} · Coeff MO {formatDecimal(workbookParameters.coeffMo)}
            {" · "}Majoration MO {workbookParameters.majorationCoefficient === null
              ? "—"
              : `×${formatDecimal(workbookParameters.majorationCoefficient)}`}
            {" · "}Taux horaire {workbookParameters.hourlyRateCents === null
              ? "—"
              : `${formatEurosFromCents(workbookParameters.hourlyRateCents)}/h`}
          </p>
          {isV3 ? null : (
            <p className="mt-1 text-muted-foreground">
              Les coefficients du classeur ne sont pas recopiés : la version applique sa marge
              (×{formatDecimal(preview.versionMarginMultiplier)}), K FO et K MO restent à 1.
              {coefficientsDiffer
                ? " Ils diffèrent de la marge de la version : les prix calculés différeront du classeur."
                : ""}
            </p>
          )}
        </div>
      ) : null}

      {isV3 && saleCoefficients ? (
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-xs text-foreground-secondary">
          <p className="font-medium text-foreground">
            {`${saleCoefficients.source === "workbook"
              ? "Coefficients du classeur proposés"
              : saleCoefficients.source === "policy"
                ? "Coefficients de vente de l’entreprise proposés"
                : "Coefficients de vente choisis"} : FO ${formatDecimal(saleCoefficients.fo)} · MO ${formatDecimal(saleCoefficients.mo)}`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Le chiffrage créé (moteur 3) applique ces coefficients de vente ; les prix et le contrôle ci-dessous en
            tiennent compte. Ils restent modifiables dans les réglages du devis.
          </p>
          <SaleCoefficientsFields
            key={`${saleCoefficients.fo}:${saleCoefficients.mo}`}
            coefficients={saleCoefficients}
            onChange={onSaleCoefficientsChange}
          />
        </div>
      ) : null}

      {laborRole.status !== "not_needed" ? (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-foreground" htmlFor="import-labor-role">
            {LABOR_ROLE_SELECT_LABEL}
          </label>
          <NativeSelect
            id="import-labor-role"
            size="sm"
            wrapperClassName="max-w-md"
            value={roleSelectValue}
            aria-invalid={roleChoiceRequired || undefined}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "") return;
              onLaborRoleChange(value === NO_LABOR_ROLE_OPTION_VALUE ? null : value);
            }}
          >
            {roleChoiceRequired ? (
              <option value="" disabled>
                Choisir un rôle…
              </option>
            ) : null}
            <option value={NO_LABOR_ROLE_OPTION_VALUE}>Aucun rôle (MO à 0 €/h)</option>
            {preview.laborRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({formatEurosFromCents(role.hourlyRateCents)}/h)
              </option>
            ))}
          </NativeSelect>
          {roleChoiceRequired ? (
            <p className="text-xs text-danger" role="alert">
              {laborRole.matchingRoleIds.length === 0
                ? "Aucun rôle actif n’a le taux horaire du classeur : choisissez le rôle qui valorise ces heures, ou « Aucun rôle »."
                : "Plusieurs rôles actifs ont le taux horaire du classeur : choisissez celui qui valorise ces heures, ou « Aucun rôle »."}
            </p>
          ) : laborRole.status === "unassigned" ? (
            <p className="text-xs text-warning">
              Sans rôle, ces heures sont valorisées à 0 €/h. Choisissez le rôle qui les valorise.
            </p>
          ) : laborRole.status === "declined" ? (
            <p className="text-xs text-warning">Sans rôle, ces heures sont valorisées à 0 €/h.</p>
          ) : null}
        </div>
      ) : null}

      {unitPriceChecks.checked > 0 ? (
        <div className="text-xs">
          <p
            className={unitPriceChecks.outOfTolerance.length > 0 ? "font-medium text-warning" : "font-medium text-success"}
          >
            Contrôle « Prix unitaire de vente » : {unitPriceChecks.checked} ligne
            {unitPriceChecks.checked > 1 ? "s" : ""} vérifiée{unitPriceChecks.checked > 1 ? "s" : ""},{" "}
            {unitPriceChecks.outOfTolerance.length} écart
            {unitPriceChecks.outOfTolerance.length > 1 ? "s" : ""} supérieur
            {unitPriceChecks.outOfTolerance.length > 1 ? "s" : ""} à {formatDecimal(unitPriceChecks.toleranceCents)} c.
          </p>
          {isV3 && unitPriceChecks.outOfTolerance.length === 0 ? (
            <p className="mt-1 text-success">
              {`Aucun écart supérieur à ${formatDecimal(unitPriceChecks.toleranceCents)} c avec « Prix Unitaire »`}
            </p>
          ) : null}
          {unitPriceChecks.outOfTolerance.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-foreground-secondary">
              {unitPriceChecks.outOfTolerance.map((check) => (
                <li key={check.rowIndex}>
                  Ligne {check.rowIndex + 1} ({check.title}) : classeur{" "}
                  {formatEurosFromCents(check.expectedUnitPriceCents)}, recalculé{" "}
                  {formatEurosFromCents(check.computedUnitPriceCents)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {invalidByReason.size > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Lignes refusées</AlertTitle>
          <ul className="mt-1 list-inside list-disc text-sm text-foreground-secondary">
            {[...invalidByReason.entries()].map(([reason, rows]) => (
              <li key={reason}>
                {INVALID_REASON_LABELS[reason]} : ligne{rows.length > 1 ? "s" : ""} {rows.slice(0, 12).join(", ")}
                {rows.length > 12 ? "…" : ""}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </section>
  );
}
