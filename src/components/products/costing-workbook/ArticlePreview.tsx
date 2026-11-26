"use client";

import { useId, useMemo, useState } from "react";

import Link from "next/link";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  inspectCostingWorkbookColumns,
  readCostingWorkbookRows,
  type CostingWorkbookArticle,
  type CostingWorkbookColumn,
  type CostingWorkbookColumnInspection,
  type CostingWorkbookSupplyKind,
} from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookImportReport } from "@/lib/catalogue/costing-workbook-contract";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import {
  ARTICLE_FINDINGS,
  articleFindings,
  missingColumnWarnings,
  type ArticleFinding,
} from "@/lib/catalogue/costing-workbook-review";
import { workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { exportToExcelWithSheets } from "@/lib/export";
import { formatEUR } from "@/lib/money";
import { foldText } from "@/lib/text/fold";

import { ArticleDuplicates, type DuplicateSearch } from "./ArticleDuplicates";
import { ColumnsPanel } from "./ColumnsPanel";
import { SupplyTypeGroups } from "./SupplyTypeGroups";
import {
  boundedPage,
  DECISIONS_PER_PAGE,
  EditableValue,
  formatCount,
  plural,
  ReviewPager,
  useWorkbookEditor,
  WorkbookReviewLayout,
  type ReviewChoice,
  type WorkbookReview,
} from "./shared";

/**
 * The preview of the draft import (TI-690, TI-711): the articles to create with what the office checks on each
 * (price, unit, material, supply type), the supply type each proposed code gets, the columns the reader found,
 * the gaps with articles the catalogue already holds, and every remark of the reading.
 */

export type SupplyTypeChoices = ReadonlyMap<string, string>;

export const SUPPLY_KIND_LABELS: Record<CostingWorkbookSupplyKind, string> = {
  tube: "Tube",
  raccord: "Raccord",
  vanne: "Vanne",
  robinetterie: "Robinetterie",
  support: "Support",
  calorifuge: "Calorifuge",
  divers: "Divers",
};

type ProposedArticle = { row: number; article: CostingWorkbookArticle; findings: ArticleFinding[] };

function ExportButton({ label, onExport }: Readonly<{ label: string; onExport: () => Promise<void> }>) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        loading={state === "busy"}
        leftIcon={<DownloadIcon aria-hidden="true" />}
        onClick={() => {
          setState("busy");
          onExport().then(() => setState("idle"), () => setState("failed"));
        }}
      >
        {label}
      </Button>
      {state === "failed" ? <span role="alert" className="text-xs text-danger">Le fichier Excel n’a pas pu être téléchargé.</span> : null}
    </span>
  );
}

export function ArticlePreview({
  report, rows, sourceInspection, review, onReviewChange, supplyTypeChoices, onSupplyTypeChoice, supplyTypeRows, onSupplyTypeRows,
  duplicateSearch, knownDuplicateRows, onDuplicateSearch, onShowSupplierReferences, onValidate, editorDirty,
}: Readonly<{
  report: CostingWorkbookImportReport;
  rows: CostingWorkbookRows;
  sourceInspection: CostingWorkbookColumnInspection;
  review: WorkbookReview;
  onReviewChange: (review: WorkbookReview) => void;
  supplyTypeChoices: SupplyTypeChoices;
  onSupplyTypeChoice: (family: string, supplyTypeId: string | null) => void;
  /** The supply type the office gave to the drafts of given rows: it comes before the family's. */
  supplyTypeRows: Readonly<Record<number, string>>;
  onSupplyTypeRows: (choices: ReadonlyArray<{ rows: readonly number[]; supplyTypeId: string | null }>) => void;
  duplicateSearch: DuplicateSearch | null;
  knownDuplicateRows: ReadonlySet<number>;
  onDuplicateSearch: (search: DuplicateSearch | null) => void;
  onShowSupplierReferences: () => void;
  onValidate?: (rows: readonly number[]) => void;
  editorDirty: boolean;
}>) {
  const { busy, applyEdits, revision, isCurrentRevision } = useWorkbookEditor();
  const [family, setFamily] = useState("");
  const [sourceUnit, setSourceUnit] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [pending, setPending] = useState<{ rows: number[]; revision: number } | null>(null);
  const supplyTypeSelectId = useId();
  const { new_articles: newArticles, already_in_catalogue: already, supplier_references_not_imported: notImported } = report;
  const { read, inspection } = useMemo(
    () => ({ read: readCostingWorkbookRows(rows), inspection: inspectCostingWorkbookColumns(rows) }),
    [rows],
  );
  const articleByRow = useMemo(() => new Map(read.articles.map((article) => [article.row, article])), [read]);
  const columnOf = useMemo(() => new Map(inspection.found.map(({ column, index }) => [column, index])), [inspection]);
  const column = (name: CostingWorkbookColumn) => columnOf.get(name);

  const companyTypes = report.supply_types ?? [];
  const typeById = new Map(companyTypes.map((type) => [type.id, type]));
  const typeByCode = new Map(companyTypes.map((type) => [type.code, type]));
  const typeOfArticle = ({ row, family_code: family, supply_type_code: kind }: CostingWorkbookArticle) => {
    const chosen = supplyTypeRows[row] ?? supplyTypeChoices.get(family ?? "");
    return (chosen ? typeById.get(chosen) : undefined) ?? typeByCode.get(kind);
  };

  const proposedAll: ProposedArticle[] = (report.proposed_articles ?? []).flatMap((proposal) => {
    const article = articleByRow.get(proposal.row);
    if (!article) return [];
    const findings = articleFindings(article, proposal.without_supply_type, {
      typeChosen: Boolean(supplyTypeRows[article.row] ?? supplyTypeChoices.get(article.family_code ?? "")),
      referenceRepeated: read.repeatedRows.has(article.row),
      possibleDuplicate: knownDuplicateRows.has(article.row),
    });
    return [{ row: proposal.row, article, findings }];
  });

  const familyGroups = new Map<string, { family: string | null; kinds: Set<CostingWorkbookSupplyKind>; rows: number[]; ready: number }>();
  for (const { row, findings, article: { family_code: family, supply_type_code: kind } } of proposedAll) {
    const key = family ? `family:${family}` : `kind:${kind}`;
    const group = familyGroups.get(key) ?? { family, kinds: new Set(), rows: [], ready: 0 };
    group.rows.push(row);
    group.kinds.add(kind);
    if (!findings.length) group.ready += 1;
    familyGroups.set(key, group);
  }
  const families = [...familyGroups.entries()].sort(([, left], [, right]) => right.rows.length - left.rows.length);
  // What the reader could not classify, or what has no supply type: the office classifies it by type of article.
  const toClassify = proposedAll.filter(({ findings }) => findings.includes("without_supply_type") || findings.includes("supply_type_defaulted"));
  const unclassified = toClassify.filter(({ row, findings }) => findings.includes("without_supply_type") || !supplyTypeRows[row]).length;
  // The search holds rows of an earlier preview: a row corrected since is no longer a draft to compare.
  const proposedRows = new Map(proposedAll.map(({ row, article }) => [row, article]));
  const duplicates = duplicateSearch
    ? { ...duplicateSearch, found: duplicateSearch.found.filter(({ row, article }) => proposedRows.get(row) === article) } : null;

  const columnWarnings = missingColumnWarnings(sourceInspection);
  const differences = (report.catalogue_differences ?? []).flatMap((difference) => {
    const article = articleByRow.get(difference.row);
    return article ? [{ ...difference, article }] : [];
  });
  // The sheet is read here as the server reads it: the screen lists every remark, the report only the first ones.
  const issues = read.issues.length === report.issue_count ? read.issues : report.issues;

  const familyRows = family ? familyGroups.get(family)?.rows ?? [] : null;
  const familyRowSet = familyRows ? new Set(familyRows) : null;
  const familyArticles = familyRowSet ? proposedAll.filter(({ row }) => familyRowSet.has(row)) : proposedAll;
  const query = foldText(review.search.trim());
  const matching = familyArticles.filter(({ article }) =>
    !query || [article.reference, article.designation, article.material ?? "", article.dimensions ?? ""].some((text) => foldText(text).includes(query)));
  const findingCounts = new Map<ArticleFinding, number>();
  for (const { findings } of matching) {
    for (const finding of findings) findingCounts.set(finding, (findingCounts.get(finding) ?? 0) + 1);
  }
  const availableFindings = (Object.keys(ARTICLE_FINDINGS) as ArticleFinding[])
    .filter((finding) => findingCounts.has(finding) || finding === review.filter);
  const activeFinding = availableFindings.find((finding) => finding === review.filter) ?? null;
  const toCheck = matching.filter(({ findings }) => findings.length > 0).length;
  const ready = matching.length - toCheck;
  const filtered = matching.filter(({ findings }) => {
    if (review.filter === "ready") return findings.length === 0;
    if (review.filter === "exceptions") return findings.length > 0;
    return !activeFinding || findings.includes(activeFinding);
  });
  const unitColumn = column("Unité");
  const sourceOf = (row: number) => unitColumn === undefined ? "" : workbookCellText(rows, row, unitColumn);
  const units = new Map<string, number>();
  if (unitColumn !== undefined) {
    for (const { row } of filtered) {
      const source = sourceOf(row);
      units.set(source, (units.get(source) ?? 0) + 1);
    }
  }
  const unitSourceActive = sourceUnit.startsWith(":");
  const proposed = unitSourceActive ? filtered.filter(({ row }) => sourceOf(row) === sourceUnit.slice(1)) : filtered;
  const selectedRows = proposed.filter(({ row, findings }) => !findings.length && !excluded.has(row)).map(({ row }) => row);
  const normalizedUnit = normalizeMeasurementUnit(newUnit).unitCode;
  const canCorrectUnits = unitColumn !== undefined && proposed.length > 0 && unitSourceActive && normalizedUnit && normalizedUnit !== sourceUnit.slice(1);
  const locked = busy || editorDirty;
  const pendingValid = pending && isCurrentRevision(pending.revision)
    && pending.rows.length === selectedRows.length && pending.rows.every((row, index) => row === selectedRows[index]);

  function filterBy(filter?: string) {
    setSourceUnit("");
    onReviewChange({ ...review, page: 0, filter });
  }

  function applyUnitCorrection() {
    if (locked || !canCorrectUnits || !normalizedUnit || unitColumn === undefined) return;
    applyEdits(proposed.map(({ row }) => ({ row, column: unitColumn, value: normalizedUnit })));
    setSourceUnit("");
    setNewUnit("");
    filterBy(undefined);
  }

  const mainViews: ReviewChoice[] = [{ id: "proposed", label: "Articles proposés", count: newArticles }];
  if (families.length > 0) mainViews.push({ id: "supply-types", label: "Types de fourniture", count: unclassified, tone: "warning" });
  mainViews.push({ id: "columns", label: "Colonnes du classeur", count: columnWarnings.length, tone: "warning" });
  const checkViews: ReviewChoice[] = [];
  if (proposedAll.length > 0) checkViews.push({ id: "duplicates", label: "Doublons possibles", count: duplicates?.found.length ?? 0, tone: "warning" });
  if (differences.length > 0) checkViews.push({ id: "differences", label: "Écarts avec le catalogue", count: differences.length });
  if (report.issue_count > 0) checkViews.push({ id: "issues", label: "Remarques sur le classeur", count: report.issue_count });
  const active = [...mainViews, ...checkViews].some(({ id }) => id === review.view) ? review.view : "proposed";

  const listed = active === "differences" ? differences.length : active === "issues" ? issues.length : proposed.length;
  const page = boundedPage(review.page, listed);
  const start = page * DECISIONS_PER_PAGE;
  const pager = <ReviewPager page={page} total={listed} onSelect={(nextPage) => onReviewChange({ ...review, page: nextPage })} />;

  const exportIssues = () => exportToExcelWithSheets([{
    name: "Remarques",
    data: issues.map((issue) => ({ row: issue.row, reference: issue.reference ?? "", message: issue.message })),
    columns: [{ key: "row", header: "Ligne Excel" }, { key: "reference", header: "Référence", numberFormat: "@" }, { key: "message", header: "Remarque" }],
  }], { filename: "remarques-classeur" });

  const exportDifferences = () => exportToExcelWithSheets([{
    name: "Écarts",
    data: differences.map(({ row, article, unit_price_cents, unit }) => ({
      row, reference: article.reference, designation: article.designation,
      workbookPrice: article.unit_price_cents / 100, cataloguePrice: unit_price_cents / 100,
      workbookUnit: article.unit, catalogueUnit: unit ?? "",
    })),
    columns: [
      { key: "row", header: "Ligne Excel" }, { key: "reference", header: "Référence", numberFormat: "@" },
      { key: "designation", header: "Désignation" },
      { key: "workbookPrice", header: "Prix du classeur (€ HT)", numberFormat: "0.00" },
      { key: "cataloguePrice", header: "Prix de référence du catalogue (€ HT)", numberFormat: "0.00" },
      { key: "workbookUnit", header: "Unité du classeur" }, { key: "catalogueUnit", header: "Unité du catalogue" },
    ],
  }], { filename: "ecarts-classeur-catalogue" });

  return (
    <section aria-labelledby="costing-workbook-preview-title" className="min-w-0 space-y-3">
      <h2 id="costing-workbook-preview-title" className="sr-only">Aperçu de l’import</h2>
      {columnWarnings.length > 0 && active !== "columns" ? (
        <Alert variant="warning">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>
              {columnWarnings.length === 1
                ? `Colonne « ${columnWarnings[0].column} » introuvable : ${columnWarnings[0].effect}.`
                : `${formatCount(columnWarnings.length)} colonnes introuvables (${columnWarnings.map(({ column: name }) => name).join(", ")}) : l’import en tiendrait compte.`}
            </span>
            <Button variant="outline" size="sm" onClick={() => onReviewChange({ ...review, page: 0, view: "columns" })}>
              Voir les colonnes
            </Button>
          </div>
        </Alert>
      ) : null}
      <WorkbookReviewLayout
        groups={[mainViews, checkViews]}
        active={active}
        onSelect={(view) => onReviewChange({ ...review, page: 0, view })}
      >
        {active === "proposed" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="typo-h3">
                {newArticles === 0
                  ? "Aucun nouvel article en brouillon"
                  : `${formatCount(newArticles)} ${plural(newArticles, "nouvel article", "nouveaux articles")} en brouillon`}
              </h3>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <li>{already === 0 ? "Aucun article déjà au catalogue" : `${formatCount(already)} déjà au catalogue (${plural(already, "inchangé", "inchangés")})`}</li>
              {report.without_supply_type > 0 ? <li>{`${formatCount(report.without_supply_type)} sans type de fourniture`}</li> : null}
              {notImported > 0 ? (
                <li>
                  {`${formatCount(notImported)} ${plural(notImported, "référence fournisseur", "références fournisseur")} à traiter séparément.`}
                </li>
              ) : null}
            </ul>
            {notImported > 0 ? (
              <p className="text-xs text-muted-foreground">
                Les références fournisseur se reprennent après les brouillons, dans l’onglet{" "}
                <Button variant="link" size="xs" className="align-baseline font-medium" onClick={onShowSupplierReferences}>
                  Références fournisseur
                </Button>.
              </p>
            ) : null}
            {proposedAll.length > 0 ? (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="grid max-w-full gap-1 text-xs font-medium">
                    Famille du classeur
                    <NativeSelect size="sm" value={family} onChange={(event) => {
                      setFamily(event.currentTarget.value);
                      filterBy(undefined);
                    }}>
                      <option value="">Toutes les familles</option>
                      {family && !familyGroups.has(family) ? <option value={family}>Famille sélectionnée · 0</option> : null}
                      {families.map(([key, group]) => (
                        <option key={key} value={key}>
                          {`${group.family ?? SUPPLY_KIND_LABELS[[...group.kinds][0]]} · ${formatCount(group.rows.length)} · ${formatCount(group.ready)} prêts · ${formatCount(group.rows.length - group.ready)} à examiner`}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <div role="group" aria-label="État des articles" className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" aria-pressed={!review.filter} onClick={() => filterBy(undefined)}>Tous</Button>
                    <Button size="sm" variant="outline" aria-pressed={review.filter === "ready"} onClick={() => filterBy("ready")}>
                      {`Prêts à valider · ${formatCount(ready)}`}
                    </Button>
                    <Button size="sm" variant="outline" aria-pressed={review.filter === "exceptions"} onClick={() => filterBy("exceptions")}>
                      {`À examiner · ${formatCount(toCheck)}`}
                    </Button>
                  </div>
                </div>
                {availableFindings.length > 0 ? (
                  <div role="group" aria-label="Articles à vérifier" className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {`${formatCount(toCheck)} ${plural(toCheck, "article à vérifier", "articles à vérifier")} :`}
                    </span>
                    {availableFindings.map((finding) => (
                      <Button
                        key={finding}
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-pressed={finding === activeFinding}
                        className="h-auto rounded-full border-border px-2.5 py-0.5 font-normal whitespace-normal text-foreground transition-none focus-visible:outline-offset-0 active:not-aria-[haspopup]:scale-100 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary hover:aria-pressed:text-primary"
                        onClick={() => filterBy(finding === activeFinding ? undefined : finding)}
                      >
                        {`${ARTICLE_FINDINGS[finding].label} · ${formatCount(findingCounts.get(finding) ?? 0)}`}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <Input
                  type="search"
                  size="sm"
                  aria-label="Rechercher un article proposé"
                  placeholder="Référence, désignation, matière ou dimension"
                  className="sm:max-w-84"
                  value={review.search}
                  onChange={(event) => {
                    setSourceUnit("");
                    onReviewChange({ ...review, search: event.currentTarget.value, page: 0 });
                  }}
                />
                {units.size > 0 || unitSourceActive ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="grid max-w-full gap-1 text-xs font-medium">
                      Unité dans le classeur
                      <NativeSelect size="sm" value={unitSourceActive ? sourceUnit : ""} onChange={(event) => {
                        setSourceUnit(event.currentTarget.value);
                        setNewUnit("");
                        onReviewChange({ ...review, page: 0 });
                      }}>
                        <option value="">Toutes les unités</option>
                        {unitSourceActive && !units.has(sourceUnit.slice(1))
                          ? <option value={sourceUnit}>{sourceUnit.slice(1) || "Unité absente"} · 0</option>
                          : null}
                        {[...units].map(([unit, count]) => (
                          <option key={unit} value={`:${unit}`}>{`${unit || "Unité absente"} · ${formatCount(count)}`}</option>
                        ))}
                      </NativeSelect>
                    </label>
                    {unitSourceActive ? (
                      <>
                        <label className="grid max-w-full gap-1 text-xs font-medium">
                          Nouvelle unité pour ces lignes
                          <Input size="sm" maxLength={50} value={newUnit} onChange={(event) => setNewUnit(event.currentTarget.value)} placeholder="m, u, kg…" />
                        </label>
                        <Button size="sm" variant="secondary" disabled={locked || !canCorrectUnits} onClick={applyUnitCorrection}>
                          {`Corriger l’unité de ${formatCount(proposed.length)} ${plural(proposed.length, "ligne", "lignes")}`}
                        </Button>
                        <p className="basis-full text-xs text-muted-foreground">Le prix actuel sera appliqué à la nouvelle unité. Vérifiez le conditionnement des lignes affichées.</p>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {onValidate && selectedRows.length > 0 ? (
                    <Button size="sm" variant="secondary" disabled={locked} onClick={() => setPending({ rows: selectedRows, revision })}>
                      {`Importer et valider ${formatCount(selectedRows.length)} ${plural(selectedRows.length, "article", "articles")}`}
                    </Button>
                  ) : null}
                  {pager}
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table aria-label="Articles proposés en brouillon" className="w-full min-w-200 text-left text-sm">
                    <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
                      <tr className="[&>th]:px-3 [&>th]:py-2.5">
                        {onValidate ? <th scope="col">Valider</th> : null}
                        <th scope="col">Ligne Excel</th>
                        <th scope="col">Référence</th>
                        <th scope="col">Désignation</th>
                        <th scope="col">Matière</th>
                        <th scope="col">Unité</th>
                        <th scope="col" className="text-right">Prix</th>
                        <th scope="col">Type de fourniture</th>
                        <th scope="col">À vérifier</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {proposed.slice(start, start + DECISIONS_PER_PAGE).map(({ row, article, findings }) => {
                        const type = typeOfArticle(article);
                        return (
                          <tr key={row} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5">
                            {onValidate ? (
                              <td>
                                {!findings.length ? (
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    checked={!excluded.has(row)}
                                    aria-label={`Sélectionner ${article.reference} pour la validation`}
                                    disabled={locked}
                                    onChange={(event) => {
                                      const checked = event.currentTarget.checked;
                                      setExcluded((previous) => {
                                        const next = new Set(previous);
                                        if (checked) next.delete(row);
                                        else next.add(row);
                                        return next;
                                      });
                                    }}
                                  />
                                ) : null}
                              </td>
                            ) : null}
                            <td className="tabular-nums">{row}</td>
                            <td><EditableValue row={row} column={column("ID")} mono display={article.reference} /></td>
                            <td>{article.designation}</td>
                            <td><EditableValue row={row} column={column("Matériau")} /></td>
                            <td>
                              <EditableValue row={row} column={column("Unité")} display={article.unit} />
                            </td>
                            <td className="text-right tabular-nums">
                              <EditableValue
                                row={row}
                                column={column("PR. FO")}
                                display={article.unit_price_cents === 0 ? "—" : formatEUR(article.unit_price_cents)}
                              />
                            </td>
                            <td>{type ? type.name : <span className="text-warning">À choisir</span>}</td>
                            <td>
                              {findings.length > 0 ? (
                                <span className="flex flex-wrap gap-1">
                                  {findings.map((finding) => (
                                    <Badge key={finding} variant="warning" size="sm" title={ARTICLE_FINDINGS[finding].label}>
                                      {ARTICLE_FINDINGS[finding].short}
                                    </Badge>
                                  ))}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {proposed.length === 0 ? (
                        <tr><td colSpan={onValidate ? 9 : 8} className="px-3 py-4 text-muted-foreground">Aucun article ne correspond à la recherche.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {active === "supply-types" ? (
          <section aria-labelledby="costing-workbook-supply-types-title" className="space-y-3">
            <div className="space-y-1">
              <h3 id="costing-workbook-supply-types-title" className="typo-h3">Types de fourniture des brouillons</h3>
              <p className="text-sm text-muted-foreground">
                Le type de fourniture fixe le coefficient FO automatique d’une ligne de devis une fois l’article validé.
                Le type proposé dépend de chaque article. Vous pouvez choisir ici un même type pour toute une famille.
              </p>
            </div>
            {companyTypes.length === 0 ? (
              <Alert variant="warning">
                L’entreprise n’a aucun type de fourniture : les brouillons seraient importés sans type et ne pourraient pas être validés.
                Un administrateur les crée depuis le catalogue, menu « Types de fourniture ».
              </Alert>
            ) : null}
            <div className="overflow-x-auto rounded-md border border-border">
              <table aria-label="Types de fourniture proposés" className="w-full min-w-120 text-left text-sm">
                <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2.5">
                    <th scope="col">Famille lue dans le classeur</th>
                    <th scope="col" className="text-right">Brouillons</th>
                    <th scope="col">Type de fourniture de l’entreprise</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {families.map(([key, { family, kinds, rows: familyRows }], index) => {
                    const [kind] = kinds;
                    const own = kinds.size === 1 ? typeByCode.get(kind) : undefined;
                    const selectId = `${supplyTypeSelectId}-${index}`;
                    const assigned = supplyTypeRows[familyRows[0]];
                    const groupChoice = familyRows.every((row) => supplyTypeRows[row] === assigned) ? assigned : undefined;
                    const selected = (family ? supplyTypeChoices.get(family) : groupChoice) ?? "";
                    function choose(value: string) {
                      if (family) onSupplyTypeChoice(family, value || null);
                      else onSupplyTypeRows([{ rows: familyRows, supplyTypeId: value || null }]);
                    }
                    return (
                      <tr key={key} className="align-middle [&>td]:px-3 [&>td]:py-2">
                        <td><label htmlFor={selectId}>{family ?? SUPPLY_KIND_LABELS[kind]}</label></td>
                        <td className="text-right tabular-nums">{formatCount(familyRows.length)}</td>
                        <td>
                          <NativeSelect
                            id={selectId}
                            size="sm"
                            wrapperClassName="max-w-72"
                            disabled={busy || companyTypes.length === 0}
                            value={selected}
                            onChange={(event) => choose(event.currentTarget.value)}
                          >
                            <option value="">{own ? `${own.name} (type proposé)` : kinds.size === 1 ? "Aucun : à préciser sur chaque brouillon" : "Types proposés par article"}</option>
                            {companyTypes.filter((type) => type.id !== own?.id).map((type) => (
                              <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                          </NativeSelect>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SupplyTypeGroups articles={toClassify} companyTypes={companyTypes} chosenRows={supplyTypeRows} onChoose={onSupplyTypeRows} />
          </section>
        ) : null}

        {active === "columns" ? <ColumnsPanel inspection={sourceInspection} /> : null}

        {active === "duplicates" ? (
          <>
            {!duplicates && proposedAll.some(({ row }) => knownDuplicateRows.has(row)) ? (
              <Alert variant="warning">Des doublons signalés restent à examiner. Relancez la recherche après les corrections.</Alert>
            ) : null}
            <ArticleDuplicates proposed={proposedAll} idColumn={column("ID")} search={duplicates} onSearch={onDuplicateSearch} />
          </>
        ) : null}

        {active === "differences" ? (
          <section aria-labelledby="costing-workbook-differences-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="costing-workbook-differences-title" className="typo-h3">
                {`${formatCount(differences.length)} ${plural(differences.length, "article du catalogue diffère", "articles du catalogue diffèrent")} du classeur`}
              </h3>
              {pager}
            </div>
            <p className="text-sm text-muted-foreground">
              L’import ne modifie jamais un article déjà au catalogue. Un prix de référence se valide depuis sa fiche
              (« Examiner le prix »), où la décision est tracée.
            </p>
            <ExportButton label="Exporter les écarts" onExport={exportDifferences} />
            <div className="overflow-x-auto rounded-md border border-border">
              <table aria-labelledby="costing-workbook-differences-title" className="w-full min-w-160 text-left text-sm">
                <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2.5">
                    <th scope="col">Ligne Excel</th>
                    <th scope="col">Article</th>
                    <th scope="col" className="text-right">Prix du classeur</th>
                    <th scope="col" className="text-right">Prix du catalogue</th>
                    <th scope="col">Unité</th>
                    <th scope="col"><span className="sr-only">Fiche</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {differences.slice(start, start + DECISIONS_PER_PAGE).map(({ row, article, product_id, unit_price_cents, unit, is_active }) => {
                    const priceDiffers = article.unit_price_cents > 0 && article.unit_price_cents !== unit_price_cents;
                    const unitDiffers = !article.unit_defaulted && foldText(article.unit) !== foldText(unit ?? "");
                    return (
                      <tr key={row} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5">
                        <td className="tabular-nums">{row}</td>
                        <td>
                          <p className="font-mono text-xs">{article.reference}</p>
                          <p>{article.designation}</p>
                          {is_active ? null : <Badge variant="neutral" size="sm">archivé</Badge>}
                        </td>
                        <td className={`text-right tabular-nums ${priceDiffers ? "font-semibold" : "text-muted-foreground"}`}>
                          {article.unit_price_cents === 0 ? "—" : formatEUR(article.unit_price_cents)}
                        </td>
                        <td className="text-right tabular-nums">{formatEUR(unit_price_cents)}</td>
                        <td className={unitDiffers ? "font-semibold" : "text-muted-foreground"}>
                          {unitDiffers ? `${article.unit} au classeur, ${unit || "aucune"} au catalogue` : article.unit}
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/products?${new URLSearchParams({ product_id })}`}
                            prefetch={false}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            Ouvrir la fiche <ExternalLinkIcon className="size-3" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {active === "issues" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="typo-h3">
                {`${formatCount(report.issue_count)} ${plural(report.issue_count, "remarque", "remarques")} sur le classeur`}
              </h3>
              {pager}
            </div>
            <ExportButton label="Exporter les remarques" onExport={exportIssues} />
            <ul aria-label="Remarques sur le classeur" className="divide-y divide-border rounded-md border border-border px-3 text-sm">
              {issues.slice(start, start + DECISIONS_PER_PAGE).map((issue, index) => (
                <li key={`${issue.row}-${index}`} className="break-words py-2">
                  {`Ligne ${issue.row}${issue.reference ? ` · ${issue.reference}` : ""} : ${issue.message}`}
                </li>
              ))}
            </ul>
            {report.issue_count > issues.length ? (
              <p className="text-xs text-muted-foreground">
                {`Les ${formatCount(issues.length)} premières sur ${formatCount(report.issue_count)}.`}
              </p>
            ) : null}
          </>
        ) : null}
      </WorkbookReviewLayout>
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogTitle>Valider les articles sélectionnés ?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.rows.length === 1
              ? "L’article sélectionné sera ajouté au catalogue et validé."
              : `Les ${formatCount(pending?.rows.length ?? 0)} articles sélectionnés seront ajoutés au catalogue et validés.`}
          </AlertDialogDescription>
          {pending && !pendingValid ? (
            <Alert variant="warning">La sélection a changé. Fermez cette fenêtre et vérifiez le lot avant de confirmer.</Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button disabled={locked || !pendingValid} onClick={() => {
              if (!pending || !pendingValid) return;
              setPending(null);
              onValidate?.(pending.rows);
            }}>
              Confirmer la validation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
