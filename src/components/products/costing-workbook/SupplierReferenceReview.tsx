"use client";

import { useEffect, useId, useMemo, useState } from "react";

import Link from "next/link";
import { DownloadIcon, ExternalLinkIcon, EyeOffIcon, PlusIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  compareCostingWorkbookSupplierValues,
  readCostingWorkbookRows,
  workbookReferenceKey,
  workbookSupplierNameKey,
  type CostingWorkbookPriceSourceKind,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import {
  exportWorkbookCorrections,
  workbookCorrection,
  WORKBOOK_CORRECTION_RULES,
} from "@/lib/catalogue/costing-workbook-corrections";
import { supplierCodeEdits } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { requestWorkbookSuggestions } from "@/lib/catalogue/costing-workbook-suggestions-client";
import {
  COSTING_WORKBOOK_SUGGESTION_LIMITS,
  type CostingWorkbookSuggestionStatus,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import {
  decisionCellKey,
  decisionGroupKind,
  groupSupplierDecisions,
  rankSupplierCandidates,
  type DecisionGroup,
  type SupplierDecision,
  type SupplierDecisionReason,
} from "@/lib/catalogue/costing-workbook-review";
import { fetchSupplierAliases, forgetSupplierAlias, rememberSupplierAlias } from "@/lib/catalogue/import-review-client";
import type { SupplierAlias } from "@/lib/catalogue/import-review-contract";
import {
  catalogueErrorMessage,
  createCatalogueSupplier,
  fetchSupplierDirectory,
  type SupplierDirectoryEntry,
} from "@/lib/catalogue/supplier-items-client";
import { exportToExcelWithSheets } from "@/lib/export";
import { foldText } from "@/lib/text/fold";

import { confidenceLabel, RETAINED_CONFIDENCE, SuggestButton, SuggestionStatus, useWorkbookAssistant } from "./assistant";
import {
  boundedPage,
  DECISIONS_PER_PAGE,
  EditableValue,
  formatCount,
  plural,
  ReviewPager,
  useWorkbookEditor,
  WorkbookCell,
  WorkbookReviewLayout,
  type ReviewChoice,
  type WorkbookReview,
} from "./shared";

/**
 * The preview and the result of the supplier reference import (TI-711). What cannot be imported is grouped by
 * the one thing to fix (an article identifier, a supplier name, a code) and fixed here: a value is corrected in
 * the rows the screen holds, a code is kept among competing ones, a supplier is created, or the workbook's name
 * for a supplier is remembered, for this import and the next ones. Each fix computes the preview again; the
 * Excel file is never written.
 */

type Source = CostingWorkbookSupplierOccurrence;
type SourceMap = ReadonlyMap<string, Source>;
type Directory = SupplierDirectoryEntry[] | "error" | null;
/** The catalogue supplier proposed for a workbook name, by the rules or by the AI source; none when `supplierId` is null. */
type SupplierSuggestion = { supplierId: string | null; label: string | null; confidence: number | null; source: "match" | "ai" };
type Outcome = { status: CostingWorkbookSuggestionStatus; message: string };

const retainable = (suggestion: SupplierSuggestion | undefined): suggestion is SupplierSuggestion & { supplierId: string } =>
  Boolean(suggestion?.supplierId) && (suggestion?.source === "match" || (suggestion?.confidence ?? 0) >= RETAINED_CONFIDENCE);

/** A code with a space or without a digit is more often a note than a supplier's code. */
const looksDoubtful = (sku: string) => /\s/.test(sku) || !/\d/.test(sku);
const CODE_KIND_LABELS = { price_source: "une source de prix, pas un code", none: "l’absence de code" } as const;

/**
 * Proposed codes that look like notes, read by the AI source chosen: it says which name a price source or no
 * code at all. Setting one aside empties its cells in the rows the screen holds; the others are imported.
 */
function DoubtfulCodes({ proposed, sourceByCell }: Readonly<{ proposed: Proposed; sourceByCell: SourceMap }>) {
  const { busy, applyEdits } = useWorkbookEditor();
  const { provider } = useWorkbookAssistant();
  const [answers, setAnswers] = useState<Array<{ value: string; kind: keyof typeof CODE_KIND_LABELS; confidence: number | null }> | null>(null);
  const [unanswered, setUnanswered] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checkedValues, setCheckedValues] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cellsOf = new Map<string, Source[]>();
  for (const entry of proposed) {
    const source = sourceByCell.get(decisionCellKey(entry));
    if (source && looksDoubtful(source.supplier_sku)) cellsOf.set(source.supplier_sku, [...(cellsOf.get(source.supplier_sku) ?? []), source]);
  }
  const values = [...cellsOf.keys()].slice(0, COSTING_WORKBOOK_SUGGESTION_LIMITS.supplierCodes);
  const valuesKey = JSON.stringify(values);
  const currentAnswer = checkedValues === valuesKey;
  if (values.length === 0) return null;

  async function check() {
    if (!provider) return;
    setLoading(true);
    setCheckedValues(valuesKey);
    setError(null);
    setAnswers(null);
    setOutcome(null);
    setUnanswered(null);
    try {
      const answer = await requestWorkbookSuggestions({ task: "supplier_codes", provider, values });
      const byValue = new Map(answer.items.map(({ value, suggestion }) => [value, suggestion]));
      setUnanswered(values.filter((value) => !byValue.get(value)).length);
      setAnswers(values.flatMap((value) => {
        const suggestion = byValue.get(value);
        return suggestion && suggestion.kind !== "code" ? [{ value, kind: suggestion.kind, confidence: suggestion.confidence }] : [];
      }));
      setOutcome({ status: answer.status, message: answer.message });
    } catch (failure) {
      setUnanswered(values.length);
      setError(catalogueErrorMessage(failure, "Les codes n’ont pas pu être vérifiés."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3 text-sm">
      <p>
        {`${formatCount(values.length)} ${plural(values.length, "code proposé ressemble", "codes proposés ressemblent")} à une note plus qu’à un code (un espace, ou aucun chiffre).`}
      </p>
      {provider ? (
        <SuggestButton label="Vérifier ces codes" withAi loading={loading} disabled={busy} onClick={() => void check()} />
      ) : (
        <p className="text-xs text-muted-foreground">Choisissez une source d’IA (« Propositions avec l’IA ») pour les faire vérifier, ou corrigez-les dans le tableau.</p>
      )}
      {currentAnswer && error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
      {currentAnswer && outcome ? <SuggestionStatus status={outcome.status} message={outcome.message} /> : null}
      {currentAnswer && unanswered ? <p className="text-xs text-muted-foreground">
        {`${formatCount(unanswered)} ${plural(unanswered, "code reste", "codes restent")} à vérifier.`}
      </p> : null}
      {currentAnswer && answers?.length === 0 && unanswered === 0 ? <p className="text-xs text-muted-foreground">L’IA lit chacun comme un code de produit.</p> : null}
      {currentAnswer && answers && answers.length > 0 ? (
        <ul aria-label="Codes à écarter" className="divide-y divide-border">
          {answers.map(({ value, kind, confidence }) => {
            const cells = cellsOf.get(value) ?? [];
            return (
              <li key={value} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
                <span className="min-w-0 wrap-anywhere">
                  « <span className="font-medium">{value}</span> » : l’IA y lit {CODE_KIND_LABELS[kind]} ({confidenceLabel(confidence)}).
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || cells.length === 0}
                  aria-label={`Écarter ${value}`}
                  onClick={() => applyEdits(cells.map((cell) => ({ row: cell.row, column: cell.column, value: null })))}
                >
                  {`Écarter (${formatCount(cells.length)} ${plural(cells.length, "cellule", "cellules")})`}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

const PRICE_SOURCE_LABELS: Record<CostingWorkbookPriceSourceKind, string> = {
  quote: "Devis",
  document: "Document",
  order: "Commande",
  regression: "Estimation par régression",
};

/** Reasons the office reads apart from the list to examine: they have their own view. */
const OWN_VIEW_REASONS: ReadonlySet<SupplierDecisionReason> = new Set([
  "price_source_reference", "conflicting_workbook_references", "article_to_create",
]);

const linkClass = "inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring";

function ProductLink({ productId, label = "Ouvrir la fiche" }: Readonly<{ productId: string; label?: string }>) {
  return (
    <Link
      href={`/dashboard/products?${new URLSearchParams({ product_id: productId })}`}
      prefetch={false}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClass}
    >
      {label} <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </Link>
  );
}

function CorrectionCell({ decision, source }: Readonly<{ decision: SupplierDecision; source?: Source }>) {
  const { row, slot, reason } = decision;
  const { field, column } = workbookCorrection(decision, source);
  if (field === "Catalogue") {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium">À vérifier dans le catalogue</p>
        <WorkbookCell row={row} slot={slot} column={source?.column} />
      </div>
    );
  }
  if (WORKBOOK_CORRECTION_RULES[reason].field === "supplier" && source && column === undefined) {
    return <p className="text-xs text-muted-foreground">{`Colonne ${field} absente du classeur`}</p>;
  }
  return <WorkbookCell row={row} slot={slot} field={field} column={column} />;
}

function articleContext(source: Source | undefined) {
  return [...new Set([source?.article_wording, source?.article_material, source?.article_dimension].filter(Boolean))].join(" · ");
}

function CatalogueArticleLookup({ source, reason }: Readonly<{ source?: Source; reason: SupplierDecisionReason }>) {
  if (!source) return null;
  const reference = source.article_reference_valid ? workbookReferenceKey(source.article_reference) : "";
  const query = (reason === "article_not_found" ? source.article_wording || reference : reference || source.article_wording)
    .slice(0, 200).trim();
  if (!query) return null;

  return (
    <Link
      href={`/dashboard/products?${new URLSearchParams({ q: query })}`}
      prefetch={false}
      target="_blank"
      rel="noopener noreferrer"
      title={`Rechercher « ${query} » dans un nouvel onglet`}
      className={linkClass}
    >
      Chercher dans le catalogue <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </Link>
  );
}

/** What the catalogue holds against the cell: its own code, the records that share a name, the article to open. */
function DecisionDetail({ decision }: Readonly<{ decision: SupplierDecision }>) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{WORKBOOK_CORRECTION_RULES[decision.reason].label}</p>
      {decision.reason === "different_existing_reference" ? (
        <p className="text-xs">
          Au catalogue : <span className="break-all font-mono font-medium">{decision.existing_supplier_sku || "aucun code"}</span>
        </p>
      ) : null}
      {decision.candidates?.length ? (
        <ul aria-label="Fiches du catalogue concernées" className="list-disc pl-4 text-xs text-muted-foreground">
          {decision.candidates.map((candidate) => <li key={candidate.id} className="break-words">{candidate.label}</li>)}
        </ul>
      ) : null}
      {decision.product_id && decision.reason !== "supplier_not_found" ? <ProductLink productId={decision.product_id} /> : null}
    </div>
  );
}

/** Sets a group aside for this session, or takes it back: nothing changes in the workbook nor in the import. */
function IgnoreButton({ subject, dismissed, onClick }: Readonly<{ subject: string; dismissed: boolean; onClick: () => void }>) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`${dismissed ? "Reprendre" : "Ignorer"} ${subject}`}
      leftIcon={dismissed ? undefined : <EyeOffIcon aria-hidden="true" />}
      onClick={onClick}
    >
      {dismissed ? "Reprendre" : "Ignorer"}
    </Button>
  );
}

function WorkbookSupplierComparisons({ title, comparisons, onKeep }: Readonly<{
  title: string;
  comparisons: ReturnType<typeof compareCostingWorkbookSupplierValues>;
  /** Given for competing product codes: keeping one writes it in the cells that hold another. */
  onKeep?: (comparison: ReturnType<typeof compareCostingWorkbookSupplierValues>[number], kept: string) => void;
}>) {
  const { busy } = useWorkbookEditor();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {onKeep ? (
        <p className="text-xs text-muted-foreground">
          Le catalogue garde un seul code par article et par fournisseur : gardez celui du produit, les autres cellules le reprennent dans l’aperçu.
        </p>
      ) : null}
      <ul aria-label={title} className="grid gap-3 2xl:grid-cols-2">
        {comparisons.map((comparison) => {
          const { key, articleReference, supplierName, values } = comparison;
          const pair = `${articleReference} · ${supplierName}`;
          return (
            <li key={key} aria-label={pair} className="space-y-2 rounded-md border border-border bg-surface p-3">
              <p className="break-all text-sm font-medium">{pair}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {values.map((value) => (
                  <div key={value.supplier_sku} className="min-w-0 rounded border border-border px-2 py-1.5 text-xs">
                    <p className="text-muted-foreground">
                      {value.price_source_kind ? `Source de prix · ${PRICE_SOURCE_LABELS[value.price_source_kind]}` : "Référence produit"}
                    </p>
                    <p className="break-all font-medium">{value.supplier_sku}</p>
                    {value.locations.slice(0, 2).map((location) => <WorkbookCell key={`${location.row}-${location.slot}`} {...location} />)}
                    {value.locations.length > 2 ? (
                      <details className="mt-1 text-muted-foreground">
                        <summary className="cursor-pointer">{`${formatCount(value.locations.length - 2)} ${plural(value.locations.length - 2, "autre cellule", "autres cellules")}`}</summary>
                        {value.locations.slice(2).map((location) => <WorkbookCell key={`${location.row}-${location.slot}`} {...location} />)}
                      </details>
                    ) : null}
                    {onKeep && !value.price_source_kind ? (
                      <Button
                        variant="outline"
                        size="xs"
                        className="mt-1.5"
                        disabled={busy}
                        aria-label={`Garder le code ${value.supplier_sku} pour ${pair}`}
                        onClick={() => onKeep(comparison, value.supplier_sku)}
                      >
                        Garder ce code
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const OMITTED_PRODUCT_URL = "Lien produit écarté : le classeur donne plusieurs adresses pour ce code.";

type CatalogueChange = (write: () => Promise<void>) => Promise<void>;

type Proposed = NonNullable<CostingWorkbookSupplierReferenceReport["proposed"]>;

function ProposedSupplierReferences({ proposed, sourceByCell, confirmed }: Readonly<{
  proposed: Proposed;
  sourceByCell: SourceMap;
  confirmed: boolean;
}>) {
  const [page, setPage] = useState(0);
  const current = boundedPage(page, proposed.length);
  const start = current * DECISIONS_PER_PAGE;
  const title = confirmed
    ? `${formatCount(proposed.length)} ${plural(proposed.length, "référence importée", "références importées")}`
    : `${formatCount(proposed.length)} ${plural(proposed.length, "référence à importer", "références à importer")}`;
  const exportList = () => exportToExcelWithSheets([{
    name: "Références",
    data: proposed.map((entry) => {
      const source = sourceByCell.get(decisionCellKey(entry));
      return {
        row: entry.row, article: entry.article_reference, designation: source?.article_wording ?? "",
        supplier: entry.supplier_name, code: source?.supplier_sku ?? "",
        note: entry.product_url_omitted ? OMITTED_PRODUCT_URL : "",
      };
    }),
    columns: [
      { key: "row", header: "Ligne Excel" }, { key: "article", header: "Article", numberFormat: "@" },
      { key: "designation", header: "Désignation" }, { key: "supplier", header: "Fournisseur" },
      { key: "code", header: "Référence fournisseur", numberFormat: "@" },
      { key: "note", header: "Remarque" },
    ],
  }], { filename: confirmed ? "references-importees" : "references-a-importer" });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="typo-h3">{title}</h3>
        <ReviewPager page={current} total={proposed.length} onSelect={setPage} />
      </div>
      {confirmed ? (
        <p className="text-sm text-muted-foreground">
          Chaque référence est enregistrée « à vérifier » sur son article : elle sert aux achats une fois validée depuis la fiche.
        </p>
      ) : null}
      {confirmed ? null : <DoubtfulCodes proposed={proposed} sourceByCell={sourceByCell} />}
      <Button variant="outline" size="sm" leftIcon={<DownloadIcon aria-hidden="true" />} onClick={() => void exportList()}>
        Exporter la liste
      </Button>
      <div className="overflow-x-auto rounded-md border border-border">
        <table
          aria-label={confirmed ? "Références importées" : "Références proposées à l’import"}
          className="w-full min-w-120 table-fixed text-left text-sm"
        >
          <thead className="border-y border-border text-xs text-foreground-secondary">
            <tr className="[&>th]:px-2 [&>th]:py-2">
              <th scope="col">Cellule</th>
              <th scope="col">Article</th>
              <th scope="col">Fournisseur</th>
              <th scope="col">Référence fournisseur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {proposed.slice(start, start + DECISIONS_PER_PAGE).map((entry) => {
              const key = decisionCellKey(entry);
              const source = sourceByCell.get(key);
              return (
                <tr key={key} className="align-top wrap-anywhere [&>td]:px-2 [&>td]:py-2">
                  <td><WorkbookCell row={entry.row} slot={entry.slot} column={source?.column} /></td>
                  <td>
                    <p>{entry.article_reference}</p>
                    {confirmed && entry.product_id ? <ProductLink productId={entry.product_id} label="Vérifier sur la fiche" /> : null}
                  </td>
                  <td>{entry.supplier_name}</td>
                  <td>
                    <p>{source?.supplier_sku || "—"}</p>
                    {entry.product_url_omitted ? <p className="text-xs text-warning">{OMITTED_PRODUCT_URL}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A supplier name the catalogue does not hold, or that several suppliers bear: one decision for every cell that
 * bears it. Associating it to a supplier is remembered: the next previews, of this workbook and of the following
 * ones, read the name as that supplier.
 */
function SupplierGroup({ group, sourceByCell, directory, suggestion, dismissed, onDismiss, onCatalogueChange }: Readonly<{
  group: DecisionGroup;
  sourceByCell: SourceMap;
  directory: Directory;
  suggestion?: SupplierSuggestion;
  dismissed: boolean;
  onDismiss: () => void;
  onCatalogueChange: CatalogueChange;
}>) {
  const selectId = useId();
  const { busy } = useWorkbookEditor();
  const [working, setWorking] = useState<"create" | "associate" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [first] = group.entries;
  const reasons = [...new Set(group.entries.map((entry) => entry.reason))];
  const archivedAlias = first.archived_supplier_alias;
  const notFound = !archivedAlias && reasons.includes("supplier_not_found");
  const candidates = notFound && Array.isArray(directory) ? rankSupplierCandidates(group.label, directory) : [];
  const blocked = busy || working !== null;

  async function change(kind: "create" | "associate" | "remove", action: () => Promise<unknown>, fallback: string) {
    setWorking(kind);
    setError(null);
    try {
      await onCatalogueChange(async () => { await action(); });
    } catch (failure) {
      setError(catalogueErrorMessage(failure, fallback));
    } finally {
      setWorking(null);
    }
  }
  const associate = (supplierId: string) =>
    change("associate", () => rememberSupplierAlias(supplierId, group.label), "Ce nom n’a pas pu être associé au fournisseur.");
  function create() {
    const name = group.label.trim();
    if (name.length > 255) {
      setError("Le nom du fournisseur ne peut pas dépasser 255 caractères. Corrigez-le avant de créer le fournisseur.");
      return;
    }
    return change("create", () => createCatalogueSupplier(name), "Le fournisseur n’a pas pu être créé.");
  }

  return (
    <tr>
      <td colSpan={5} className="px-3 py-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="font-medium wrap-anywhere">
                {group.label}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {`· ${formatCount(group.entries.length)} ${plural(group.entries.length, "référence", "références")}`}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{reasons.map((reason) => WORKBOOK_CORRECTION_RULES[reason].label).join(" · ")}</p>
            </div>
            <IgnoreButton subject={`le fournisseur ${group.label}`} dismissed={dismissed} onClick={onDismiss} />
          </div>
          {archivedAlias ? (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>{`Ce nom est associé au fournisseur archivé « ${archivedAlias.supplier_name} ».`}</p>
              {archivedAlias.can_remove ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  loading={working === "remove"}
                  aria-label={`Retirer l’association de ${group.label}`}
                  onClick={() => void change("remove", () => forgetSupplierAlias(archivedAlias.id), "Cette association n’a pas pu être retirée.")}
                >
                  Retirer l’association
                </Button>
              ) : <p>Seul l’auteur ou un administrateur peut retirer cette association.</p>}
            </div>
          ) : null}
          {!archivedAlias && first.candidates?.length ? (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>Plusieurs fournisseurs actifs portent ce nom. Dites lequel le classeur désigne :</p>
              <div className="flex flex-wrap gap-2">
                {first.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    variant="secondary"
                    size="sm"
                    disabled={blocked}
                    aria-label={`Associer ${group.label} à ${candidate.label}`}
                    onClick={() => void associate(candidate.id)}
                  >
                    {`C’est ${candidate.label}`}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {notFound && suggestion ? (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              {suggestion.supplierId && suggestion.label ? (
                <>
                  <span>
                    {`Proposition : ${suggestion.label}`}
                    {suggestion.source === "ai" ? ` (IA, ${confidenceLabel(suggestion.confidence)})` : " (même nom)"}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={blocked}
                    aria-label={`Retenir ${suggestion.label} pour ${group.label}`}
                    onClick={() => void associate(suggestion.supplierId!)}
                  >
                    Retenir
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">L’IA ne reconnaît aucun fournisseur du catalogue sous ce nom : créez-le, ou associez-le vous-même.</span>
              )}
            </p>
          ) : null}
          {notFound ? (
            <div className="flex flex-wrap items-center gap-2">
              {candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  variant="secondary"
                  size="sm"
                  disabled={blocked}
                  title={`Lire « ${group.label} » comme ${candidate.name}, dans cet import et les suivants`}
                  aria-label={`Associer ${group.label} à ${candidate.label}`}
                  onClick={() => void associate(candidate.id)}
                >
                  {`C’est ${candidate.label}`}
                </Button>
              ))}
              <div className="min-w-48 flex-1 sm:max-w-64">
                <label htmlFor={selectId} className="sr-only">{`Fournisseur du catalogue pour ${group.label}`}</label>
                <NativeSelect
                  id={selectId}
                  size="sm"
                  value=""
                  disabled={blocked || !Array.isArray(directory)}
                  onChange={(event) => {
                    if (event.currentTarget.value) void associate(event.currentTarget.value);
                  }}
                >
                  <option value="">
                    {directory === null ? "Chargement des fournisseurs…" : directory === "error" ? "Liste des fournisseurs indisponible" : "Associer à un fournisseur…"}
                  </option>
                  {Array.isArray(directory) ? directory.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>) : null}
                </NativeSelect>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={working === "create"}
                disabled={blocked}
                leftIcon={<PlusIcon aria-hidden="true" />}
                aria-label={`Créer le fournisseur ${group.label}`}
                onClick={() => void create()}
              >
                Créer ce fournisseur
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">Voir les cellules</summary>
            <ul className="mt-1 divide-y divide-border">
              {group.entries.map((entry) => {
                const cellKey = decisionCellKey(entry);
                const cell = sourceByCell.get(cellKey);
                return (
                  <li key={cellKey} className="grid gap-1 break-words py-2 sm:grid-cols-[9rem_1fr_1fr_1fr] sm:gap-3">
                    <CorrectionCell decision={entry} source={cell} />
                    <span>{cell?.article_reference || "Sans ID"}</span>
                    <EditableValue row={entry.row} column={cell?.supplier_name_column} empty="Sans nom" />
                    <span className="break-all">{cell?.supplier_sku || "—"}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        </div>
      </td>
    </tr>
  );
}

export function SupplierReferenceReview({ report, rows, review, onReviewChange, dismissed, onDismiss, onShowDrafts, onCatalogueChange }: Readonly<{
  report: CostingWorkbookSupplierReferenceReport;
  rows: CostingWorkbookRows;
  review: WorkbookReview;
  onReviewChange: (review: WorkbookReview) => void;
  /** Cells the office set aside for this session (`row-slot`): out of the list, never out of the workbook. */
  dismissed: ReadonlySet<string>;
  onDismiss: (cells: string[], dismissed: boolean) => void;
  /** The articles these references wait for are created by the draft import: shows it. */
  onShowDrafts: () => void;
  onCatalogueChange: CatalogueChange;
}>) {
  const { applyEdits, busy } = useWorkbookEditor();
  const { provider } = useWorkbookAssistant();
  const [supplierSuggestions, setSupplierSuggestions] = useState<ReadonlyMap<string, SupplierSuggestion>>(new Map());
  const [suggestionOutcome, setSuggestionOutcome] = useState<Outcome | null>(null);
  const [suggesting, setSuggesting] = useState<"ask" | "retain" | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [aliases, setAliases] = useState<SupplierAlias[]>([]);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [directory, setDirectory] = useState<Directory>(null);
  const { sourceByCell, comparisons } = useMemo(() => {
    const { supplierReferenceOccurrences } = readCostingWorkbookRows(rows);
    return {
      sourceByCell: new Map(supplierReferenceOccurrences.map((source) => [decisionCellKey(source), source])),
      comparisons: compareCostingWorkbookSupplierValues(supplierReferenceOccurrences),
    };
  }, [rows]);

  const needsDirectory = report.for_decision.some((entry) => entry.reason === "supplier_not_found" && !entry.archived_supplier_alias);
  useEffect(() => {
    if (!needsDirectory || directory !== null) return;
    const abort = new AbortController();
    fetchSupplierDirectory(abort.signal, "active").then(
      (entries) => { if (!abort.signal.aborted) setDirectory(entries); },
      () => { if (!abort.signal.aborted) setDirectory("error"); },
    );
    return () => abort.abort();
  }, [needsDirectory, directory]);

  // The names the office associated to suppliers: read again with each report, which they may have changed.
  useEffect(() => {
    const abort = new AbortController();
    fetchSupplierAliases(abort.signal).then(
      (items) => { if (!abort.signal.aborted) setAliases(items); },
      () => undefined,
    );
    return () => abort.abort();
  }, [report]);

  async function forgetAlias(alias: SupplierAlias) {
    setAliasError(null);
    try {
      await onCatalogueChange(async () => {
        await forgetSupplierAlias(alias.id);
        setAliases((previous) => previous.filter((entry) => entry.id !== alias.id));
      });
    } catch (failure) {
      setAliasError(catalogueErrorMessage(failure, "Cette association n’a pas pu être retirée."));
    }
  }

  // A conflict is the server's: several codes for one catalogue article and one catalogue supplier, whatever
  // names the workbook wrote for them. Every value the workbook gives those names is shown with it, the price
  // sources too: they say where a code may be found.
  const writtenPairOf = (source: CostingWorkbookSupplierOccurrence) =>
    JSON.stringify([workbookReferenceKey(source.article_reference), workbookSupplierNameKey(source.supplier_name)]);
  const resolvedPairs = new Map<string, string>();
  for (const decision of report.for_decision) {
    if (decision.reason !== "conflicting_workbook_references" || !decision.product_id || !decision.supplier_id) continue;
    const source = sourceByCell.get(decisionCellKey(decision));
    if (source) resolvedPairs.set(writtenPairOf(source), JSON.stringify([decision.product_id, decision.supplier_id]));
  }
  const conflicts = compareCostingWorkbookSupplierValues(
    [...sourceByCell.values()].filter((source) => resolvedPairs.has(writtenPairOf(source))),
    (source) => resolvedPairs.get(writtenPairOf(source))!,
  ).filter(({ values }) => values.filter((value) => !value.price_source_kind).length > 1);
  const priceComparisons = comparisons.filter(({ values }) => values.filter((value) => !value.price_source_kind).length < 2);
  const priceSources = report.for_decision.filter((entry) => entry.reason === "price_source_reference");
  const toCreate = report.for_decision.filter((entry) => entry.reason === "article_to_create");
  const articlesToCreate = groupSupplierDecisions(toCreate, sourceByCell, true);
  const toCreatePage = boundedPage(review.page, articlesToCreate.length);
  const toCreateStart = toCreatePage * DECISIONS_PER_PAGE;
  const examinable = report.for_decision.filter((entry) => !OWN_VIEW_REASONS.has(entry.reason));
  const dismissedCount = examinable.filter((entry) => dismissed.has(decisionCellKey(entry))).length;
  const decisions = showDismissed ? examinable : examinable.filter((entry) => !dismissed.has(decisionCellKey(entry)));

  const countsByReason = new Map<SupplierDecisionReason, number>();
  for (const { reason } of decisions) countsByReason.set(reason, (countsByReason.get(reason) ?? 0) + 1);
  const availableReasons = [...countsByReason.keys()]
    .sort((a, b) => (countsByReason.get(b) ?? 0) - (countsByReason.get(a) ?? 0)
      || WORKBOOK_CORRECTION_RULES[a].label.localeCompare(WORKBOOK_CORRECTION_RULES[b].label, "fr"));
  const waitingViews: ReviewChoice[] = toCreate.length
    ? [{ id: "to-create", label: "Articles à créer d’abord", count: articlesToCreate.length, tone: "warning" }] : [];
  // Kept while cells are set aside: the list is where the office takes them back.
  const decisionViews: ReviewChoice[] = decisions.length || dismissedCount
    ? [{ id: "all", label: "Toutes à examiner", count: decisions.length }] : [];
  for (const reason of availableReasons) {
    decisionViews.push({ id: reason, label: WORKBOOK_CORRECTION_RULES[reason].label, count: countsByReason.get(reason) ?? 0 });
  }
  const proposed = report.proposed ?? [];
  const resultViews: ReviewChoice[] = [];
  if (report.confirmed ? proposed.length > 0 : report.to_import > 0) {
    resultViews.push(report.confirmed
      ? { id: "proposed", label: "Importées, à vérifier", count: proposed.length }
      : { id: "proposed", label: "Proposées à l’import", count: report.to_import });
  }
  if (conflicts.length > 0) resultViews.push({ id: "conflicts", label: "Codes à départager", count: conflicts.length });
  if (priceSources.length || priceComparisons.length) {
    resultViews.push({ id: "prices", label: "Sources de prix", count: priceSources.length });
  }
  if (aliases.length > 0) resultViews.push({ id: "aliases", label: "Noms associés", count: aliases.length });
  const allViews = [...decisionViews, ...waitingViews, ...resultViews];
  const active = allViews.some(({ id }) => id === review.view) ? review.view : allViews[0]?.id ?? "all";
  const activeReason = availableReasons.find((reason) => reason === active) ?? null;

  const search = foldText(review.search.trim());
  const filteredDecisions = decisions.filter((entry) => {
    if (activeReason && entry.reason !== activeReason) return false;
    if (!search) return true;
    const source = sourceByCell.get(decisionCellKey(entry));
    return source && [source.article_reference, source.supplier_name, source.supplier_sku, source.article_wording]
      .some((text) => foldText(text).includes(search));
  });
  const groupKind = activeReason ? decisionGroupKind(activeReason) : "cell";
  const groups = groupSupplierDecisions(filteredDecisions, sourceByCell, activeReason !== null);
  const decisionCount = filteredDecisions.length;
  const currentPage = boundedPage(review.page, groups.length);
  const pageStart = currentPage * DECISIONS_PER_PAGE;
  const imported = report.imported;
  const existing = report.already_registered;
  const groupNoun = groupKind === "supplier" ? ["fournisseur distinct", "fournisseurs distincts"] : ["article distinct", "articles distincts"];

  /** The workbook names no supplier bears, each once: what a proposal is asked for. */
  const unknownSuppliers = groupSupplierDecisions(decisions.filter((entry) => entry.reason === "supplier_not_found" && !entry.archived_supplier_alias), sourceByCell, true)
    .filter((group) => group.kind === "supplier");
  const retained = unknownSuppliers.flatMap((group) => {
    const suggestion = supplierSuggestions.get(workbookSupplierNameKey(group.label));
    return retainable(suggestion) ? [{ name: group.label, supplierId: suggestion.supplierId }] : [];
  });

  async function suggestSuppliers() {
    setSuggesting("ask");
    setSuggestionError(null);
    try {
      const answer = await requestWorkbookSuggestions({
        task: "suppliers",
        ...(provider ? { provider } : {}),
        names: unknownSuppliers.slice(0, COSTING_WORKBOOK_SUGGESTION_LIMITS.suppliers).map((group) => group.label.slice(0, 255)),
      });
      setSupplierSuggestions(new Map(answer.items.flatMap((item) => (item.suggestion ? [[workbookSupplierNameKey(item.name), {
        supplierId: item.suggestion.supplier_id,
        label: item.candidates.find((candidate) => candidate.supplier_id === item.suggestion?.supplier_id)?.label ?? null,
        confidence: item.suggestion.confidence,
        source: item.suggestion.source,
      }] as const] : []))));
      setSuggestionOutcome({ status: answer.status, message: answer.message });
    } catch (failure) {
      setSuggestionError(catalogueErrorMessage(failure, "Les propositions de fournisseurs n’ont pas pu être demandées."));
    } finally {
      setSuggesting(null);
    }
  }

  /** The proposals the rules found or the model is sure of, remembered one after the other, then one new preview. */
  async function retainSuggestions() {
    setSuggesting("retain");
    setSuggestionError(null);
    try {
      await onCatalogueChange(async () => {
        try {
          for (const { name, supplierId } of retained) await rememberSupplierAlias(supplierId, name);
        } catch (failure) {
          setSuggestionError(catalogueErrorMessage(failure, "Une proposition n’a pas pu être retenue."));
        }
      });
    } finally {
      setSuggesting(null);
    }
  }

  async function downloadCorrections() {
    if (!filteredDecisions.length || exporting) return;
    setExporting(true);
    setExportError(false);
    try {
      await exportWorkbookCorrections(activeReason, filteredDecisions, sourceByCell);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  const dismiss = (entries: readonly SupplierDecision[]) => onDismiss(entries.map(decisionCellKey), true);

  return (
    <section aria-labelledby="costing-workbook-supplier-report" className="min-w-0 space-y-3">
      <h2 id="costing-workbook-supplier-report" className="sr-only">
        {report.confirmed ? "Résultat de l’import" : "Aperçu de l’import"}
      </h2>
      {report.confirmed ? (
        <Alert variant="success">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>{formatCount(imported) + " " + plural(imported, "référence importée", "références importées") + ", à vérifier."}</span>
            {report.import_batch_id ? (
              <Link
                href={`/dashboard/products/supplier-references?${new URLSearchParams({ import_batch_id: report.import_batch_id })}`}
                className={linkClass}
              >
                Les vérifier ensemble
              </Link>
            ) : null}
          </div>
        </Alert>
      ) : null}
      {existing > 0 || report.duplicates > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {existing > 0 ? (
            <p>{formatCount(existing) + " " + plural(existing, "référence déjà enregistrée", "références déjà enregistrées")}</p>
          ) : null}
          {report.duplicates > 0 ? (
            <p>{formatCount(report.duplicates) + " " + plural(report.duplicates, "doublon identique regroupé", "doublons identiques regroupés")}</p>
          ) : null}
        </div>
      ) : null}
      <WorkbookReviewLayout
        groups={[decisionViews, waitingViews, resultViews]}
        active={active}
        onSelect={(view) => {
          if (view !== active) onReviewChange({ ...review, view, page: 0 });
        }}
      >
        {active === "to-create" ? (
          <section aria-labelledby="costing-workbook-to-create-title" className="space-y-3">
            <h3 id="costing-workbook-to-create-title" className="typo-h3">
              {`${formatCount(toCreate.length)} ${plural(toCreate.length, "référence attend", "références attendent")} ${formatCount(articlesToCreate.length)} ${plural(articlesToCreate.length, "article à créer", "articles à créer")}`}
            </h3>
            <p className="text-sm text-muted-foreground">
              Ces articles ne sont pas encore au catalogue : l’onglet « Articles en brouillon » les crée. Importez-les d’abord,
              leurs références seront proposées ici ensuite. Rien n’est à corriger dans le classeur.
            </p>
            <Button variant="secondary" size="sm" onClick={onShowDrafts}>Voir les articles à importer</Button>
            <ReviewPager page={toCreatePage} total={articlesToCreate.length} onSelect={(page) => onReviewChange({ ...review, page })} />
            <ul aria-label="Articles à créer d’abord" className="divide-y divide-border rounded-md border border-border px-3 text-sm">
              {articlesToCreate.slice(toCreateStart, toCreateStart + DECISIONS_PER_PAGE).map((group) => {
                const source = sourceByCell.get(decisionCellKey(group.entries[0]));
                const context = articleContext(source);
                return (
                  <li key={group.key} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                    <span className="min-w-0 wrap-anywhere">
                      <span className="font-mono text-xs">{source?.article_reference}</span>
                      {context ? <span className="text-muted-foreground">{` · ${context}`}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {`${formatCount(group.entries.length)} ${plural(group.entries.length, "référence", "références")}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {active === "proposed" ? (
          proposed.length
            ? <ProposedSupplierReferences proposed={proposed} sourceByCell={sourceByCell} confirmed={report.confirmed} />
            : <h3 className="typo-h3">{formatCount(report.to_import) + " " + plural(report.to_import, "référence", "références") + " à importer"}</h3>
        ) : null}
        {active === "conflicts" ? (
          <WorkbookSupplierComparisons
            title="Références produit à départager"
            comparisons={conflicts}
            onKeep={report.confirmed ? undefined : (comparison, kept) => applyEdits(supplierCodeEdits(
              comparison.values.filter((value) => !value.price_source_kind)
                .flatMap((value) => value.locations.map((location) => ({ ...location, supplier_sku: value.supplier_sku }))),
              kept,
            ))}
          />
        ) : null}
        {active === "aliases" ? (
          <section aria-labelledby="costing-workbook-aliases-title" className="space-y-3">
            <h3 id="costing-workbook-aliases-title" className="typo-h3">
              {`${formatCount(aliases.length)} ${plural(aliases.length, "nom associé", "noms associés")} à un fournisseur`}
            </h3>
            <p className="text-sm text-muted-foreground">
              Un nom que le classeur écrit autrement que le catalogue, lu comme le fournisseur associé dans cet import et les suivants.
            </p>
            {aliasError ? <Alert variant="danger">{aliasError}</Alert> : null}
            <ul aria-label="Noms associés" className="divide-y divide-border rounded-md border border-border px-3 text-sm">
              {aliases.map((alias) => (
                <li key={alias.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 wrap-anywhere">
                    « {alias.alias} » <span className="text-muted-foreground">est</span> <span className="font-medium">{alias.supplier_name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    aria-label={`Retirer l’association de ${alias.alias}`}
                    onClick={() => void forgetAlias(alias)}
                  >
                    Retirer
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {active === "prices" ? (
          <>
            {priceComparisons.length > 0 ? (
              <WorkbookSupplierComparisons title="Valeurs avec sources de prix" comparisons={priceComparisons} />
            ) : null}
            {priceSources.length > 0 ? (
              <section className="space-y-2">
                <h3 className="typo-h3">
                  {formatCount(priceSources.length) + " " + plural(priceSources.length, "source de prix écartée", "sources de prix écartées")}
                </h3>
                <ul aria-label="Sources de prix du classeur" className="grid gap-x-4 text-sm sm:grid-cols-2">
                  {priceSources.map((entry) => {
                    const key = decisionCellKey(entry);
                    const source = sourceByCell.get(key);
                    return (
                      <li key={key} className="break-words border-t border-border py-2">
                        <p>{source?.supplier_sku}</p>
                        {source?.price_source_kind ? <p className="text-xs text-muted-foreground">{PRICE_SOURCE_LABELS[source.price_source_kind]}</p> : null}
                        <WorkbookCell row={entry.row} slot={entry.slot} column={source?.column} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        {(active === "all" || activeReason) && examinable.length > 0 ? (
          <section aria-labelledby="costing-workbook-decisions-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="costing-workbook-decisions-title" aria-live="polite" className="text-sm font-semibold">
                {formatCount(decisionCount) + " " + plural(decisionCount, "référence à examiner", "références à examiner")}
              </h3>
              {groupKind !== "cell" && decisionCount > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {`${formatCount(groups.length)} ${plural(groups.length, groupNoun[0], groupNoun[1])}`}
                </span>
              ) : null}
              <ReviewPager
                page={currentPage}
                total={groups.length}
                onSelect={(page) => onReviewChange({ ...review, page })}
                suffix={groupKind === "article" ? " articles" : groupKind === "supplier" ? " fournisseurs" : ""}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                size="sm"
                aria-label="Rechercher par article, fournisseur ou code fournisseur"
                placeholder="Article, fournisseur ou code fournisseur"
                className="sm:max-w-84"
                value={review.search}
                onChange={(event) => onReviewChange({ ...review, search: event.currentTarget.value, page: 0 })}
              />
              <Button
                variant="outline"
                size="sm"
                loading={exporting}
                disabled={decisionCount === 0}
                leftIcon={<DownloadIcon aria-hidden="true" />}
                onClick={() => void downloadCorrections()}
              >
                Exporter les corrections
              </Button>
              {activeReason === "supplier_not_found" && unknownSuppliers.length > 0 ? (
                <>
                  <SuggestButton
                    label="Proposer des fournisseurs"
                    withAi
                    loading={suggesting === "ask"}
                    disabled={busy || suggesting !== null}
                    onClick={() => void suggestSuppliers()}
                  />
                  {retained.length > 0 ? (
                    <Button variant="outline" size="sm" loading={suggesting === "retain"} disabled={busy || suggesting !== null} onClick={() => void retainSuggestions()}>
                      {`Retenir ${formatCount(retained.length)} ${plural(retained.length, "proposition", "propositions")}`}
                    </Button>
                  ) : null}
                </>
              ) : null}
              {dismissedCount > 0 ? (
                <Button variant="ghost" size="sm" aria-pressed={showDismissed} onClick={() => setShowDismissed((shown) => !shown)}>
                  {showDismissed
                    ? "Masquer les références ignorées"
                    : `Afficher ${formatCount(dismissedCount)} ${plural(dismissedCount, "référence ignorée", "références ignorées")}`}
                </Button>
              ) : null}
            </div>
            {exportError ? (
              <Alert variant="danger">Le fichier Excel n’a pas pu être téléchargé. Réessayez.</Alert>
            ) : null}
            {activeReason === "supplier_not_found" && suggestionError ? <p role="alert" className="text-xs font-medium text-danger">{suggestionError}</p> : null}
            {activeReason === "supplier_not_found" && suggestionOutcome ? <SuggestionStatus {...suggestionOutcome} /> : null}
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              <table aria-labelledby="costing-workbook-decisions-title" className="w-full min-w-150 table-fixed text-left text-sm">
                <thead className="border-b border-border bg-surface-subtle text-xs text-foreground-secondary">
                  <tr className="[&>th]:px-3 [&>th]:py-2.5">
                    <th scope="col" className="w-36">Cellule à vérifier</th>
                    <th scope="col">Article</th>
                    <th scope="col">Fournisseur</th>
                    <th scope="col">Référence fournisseur</th>
                    <th scope="col" className="w-1/4">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {decisionCount === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                        {search ? "Aucune référence ne correspond à la recherche." : "Aucune référence à examiner dans cette vue."}
                      </td>
                    </tr>
                  ) : null}
                  {groups.slice(pageStart, pageStart + DECISIONS_PER_PAGE).map((group) => {
                    const { key, entries } = group;
                    const [entry] = entries;
                    const source = sourceByCell.get(decisionCellKey(entry));
                    const context = articleContext(source);
                    const isDismissed = entries.every((occurrence) => dismissed.has(decisionCellKey(occurrence)));
                    const toggleDismissed = () => (isDismissed ? onDismiss(entries.map(decisionCellKey), false) : dismiss(entries));
                    if (group.kind === "supplier") {
                      return (
                        <SupplierGroup
                          key={key}
                          group={group}
                          sourceByCell={sourceByCell}
                          directory={directory}
                          suggestion={supplierSuggestions.get(workbookSupplierNameKey(group.label))}
                          dismissed={isDismissed}
                          onDismiss={toggleDismissed}
                          onCatalogueChange={onCatalogueChange}
                        />
                      );
                    }
                    if (entries.length > 1) {
                      return (
                        <tr key={key}>
                          <td colSpan={5} className="px-3 py-2.5">
                            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                              <details className="min-w-0 flex-1">
                                <summary className="cursor-pointer font-medium">
                                  {source?.article_reference} <span className="text-xs text-muted-foreground">· {formatCount(entries.length)} occurrences</span>
                                  {context ? <span className="block text-xs font-normal text-muted-foreground">{context}</span> : null}
                                </summary>
                                <ul className="mt-2 divide-y divide-border">
                                  {entries.map((occurrence) => {
                                    const cellKey = decisionCellKey(occurrence);
                                    const cell = sourceByCell.get(cellKey);
                                    const contextAtCell = articleContext(cell);
                                    return (
                                      <li key={cellKey} className="grid gap-1 break-words py-2 sm:grid-cols-[8rem_1fr_1fr_1fr] sm:gap-3">
                                        <CorrectionCell decision={occurrence} source={cell} />
                                        <EditableValue row={occurrence.row} column={cell?.article_column} mono empty="Sans ID" />
                                        <span>{cell?.supplier_name || "Sans nom"}</span>
                                        <span>{cell?.supplier_sku || "—"}</span>
                                        {contextAtCell && contextAtCell !== context ? (
                                          <div className="sm:col-span-full">
                                            <p className="text-xs text-muted-foreground">{contextAtCell}</p>
                                            <CatalogueArticleLookup source={cell} reason={occurrence.reason} />
                                          </div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </details>
                              <div className="flex flex-col items-end gap-1">
                                <CatalogueArticleLookup source={source} reason={entry.reason} />
                                <IgnoreButton subject={`l’article ${source?.article_reference ?? ""}`} dismissed={isDismissed} onClick={toggleDismissed} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={key} className={`align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5 ${isDismissed ? "opacity-60" : ""}`}>
                        <td><CorrectionCell decision={entry} source={source} /></td>
                        <td>
                          <EditableValue row={entry.row} column={source?.article_column} empty="Sans ID" />
                          {context ? <p className="text-xs text-muted-foreground">{context}</p> : null}
                          <CatalogueArticleLookup source={source} reason={entry.reason} />
                        </td>
                        <td><EditableValue row={entry.row} column={source?.supplier_name_column} empty="Sans nom" /></td>
                        <td><EditableValue row={entry.row} column={source?.column} /></td>
                        <td>
                          <DecisionDetail decision={entry} />
                          <div className="mt-1 -ml-2">
                            <IgnoreButton
                              subject={`la référence de la ligne ${entry.row}, fournisseur ${entry.slot}`}
                              dismissed={isDismissed}
                              onClick={toggleDismissed}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {allViews.length === 0 ? (
          <h3 className="typo-h3">Aucune référence à examiner</h3>
        ) : null}
      </WorkbookReviewLayout>
    </section>
  );
}
