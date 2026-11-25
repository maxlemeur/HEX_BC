"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { CopyIcon, DownloadIcon, ExternalLinkIcon, FileSpreadsheetIcon, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  compareCostingWorkbookSupplierValues,
  COSTING_WORKBOOK_SHEET,
  readCostingWorkbookRows,
  workbookReferenceKey,
  type CostingWorkbookPriceSourceKind,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import {
  COSTING_WORKBOOK_FORMAT,
  COSTING_WORKBOOK_IMPORT_INCOMPLETE,
  costingWorkbookSupplierReferenceReportSchema,
  type CostingWorkbookImportReport,
  type CostingWorkbookSupplierReferenceReport,
} from "@/lib/catalogue/costing-workbook-contract";
import {
  CostingWorkbookFileError,
  costingWorkbookImportBody,
  readCostingWorkbookFile,
  type CostingWorkbookRows,
} from "@/lib/catalogue/costing-workbook-file";
import {
  exportWorkbookCorrections,
  workbookCellAddress,
  workbookCorrection,
  WORKBOOK_CORRECTION_RULES,
  type SupplierDecision,
} from "@/lib/catalogue/costing-workbook-corrections";
import { foldText } from "@/lib/text/fold";
import { asRecord } from "@/lib/value-guards";

/**
 * Imports the office's costing workbook (« bible de chiffrage ») into catalogue drafts (TI-690, lot 1). The
 * browser reads the sheet « All_data » and asks the server for a preview (`confirm: false`, nothing written);
 * the office reads what the import will do, then confirms (`confirm: true`) with the same rows. Every draft is
 * then checked and validated one by one in the catalogue.
 */

export type CostingWorkbookImportProps = {
  catalogueHref: string;
  draftsHref: string;
  onImported: () => void | Promise<void>;
};

const ENDPOINT = "/api/catalogue/workbook-import";
const FILE_INPUT_ID = "costing-workbook-file";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DECISIONS_PER_PAGE = 30;

const NETWORK_FAILURE = "Le serveur n’a pas répondu. Vérifiez la connexion, puis réessayez.";
const UNREADABLE_FILE = "Ce fichier n’a pas pu être lu comme un classeur Excel.";

type Phase = "idle" | "reading" | "previewing" | "importing";

type Mode = "articles" | "supplier-references";
type Report = CostingWorkbookImportReport | CostingWorkbookSupplierReferenceReport;
type WorkbookReview = { page: number; view: string; search: string };
const INITIAL_SUPPLIER_REVIEW: WorkbookReview = { page: 0, view: "all", search: "" };
const INITIAL_ARTICLE_REVIEW: WorkbookReview = { page: 0, view: "proposed", search: "" };

const PHASE_LABELS: Record<Exclude<Phase, "idle">, string> = {
  reading: "Lecture du classeur…",
  previewing: "Comparaison avec le catalogue…",
  importing: "Création des brouillons…",
};

type Outcome =
  | { ok: true; report: Report }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; message: string; retry: boolean; stale: boolean };

const formatCount = (value: number) => value.toLocaleString("fr-FR");

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}
function isReport(value: unknown): value is CostingWorkbookImportReport {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.new_articles === "number" &&
      typeof record.already_in_catalogue === "number" &&
      typeof record.supplier_references_not_imported === "number" &&
      Array.isArray(record.issues),
  );
}

/** A refusal in the server's words when it has some, in plain words otherwise. */
function refusal(status: number, payload: unknown): Extract<Outcome, { aborted: false }> {
  const error = asRecord(asRecord(payload)?.error);
  const code = typeof error?.code === "string" ? error.code : null;
  const serverMessage = typeof error?.message === "string" && error.message.trim() ? error.message : null;
  // The schema's refusal (« Payload invalide. ») says nothing to the office: the dialog's own sentence instead.
  const message = code === "VALIDATION_ERROR" ? null : serverMessage;
  // Drafts may have been created (an import stopped half-way) or the catalogue changed meanwhile (409): the
  // preview no longer holds, a new one counts what is left.
  const stale = code === COSTING_WORKBOOK_IMPORT_INCOMPLETE || status === 409;
  let fallback: string;
  if (code === COSTING_WORKBOOK_IMPORT_INCOMPLETE) {
    fallback = "L’import s’est arrêté en cours de route. Relancez-le : il reprend où il s’est arrêté.";
  } else if (code === COSTING_WORKBOOK_FORMAT || status === 422) {
    fallback = "Ce classeur n’a pas la forme attendue.";
  } else if (status === 403) {
    fallback = "L’import du classeur est réservé aux administrateurs et aux ingénieurs.";
  } else if (status === 413) {
    fallback = `L’onglet « ${COSTING_WORKBOOK_SHEET} » est trop lourd pour être envoyé.`;
  } else if (status === 400) {
    fallback = `Le serveur a refusé le contenu de l’onglet « ${COSTING_WORKBOOK_SHEET} ».`;
  } else {
    fallback = `L’import n’a pas abouti (erreur ${status}). Réessayez dans un instant.`;
  }
  // The file itself is refused (format, rights, size, content): choosing it again changes nothing.
  const retry = stale || ![400, 403, 413, 422].includes(status);
  return { ok: false, aborted: false, message: message ?? fallback, retry, stale };
}

export function CostingWorkbookImport({
  catalogueHref,
  draftsHref,
  onImported,
}: Readonly<CostingWorkbookImportProps>) {
  const [mode, setMode] = useState<Mode>("articles");
  const [rows, setRows] = useState<CostingWorkbookRows | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [previews, setPreviews] = useState<Partial<Record<Mode, Report>>>({});
  const [results, setResults] = useState<Partial<Record<Mode, Report>>>({});
  const [supplierReview, setSupplierReview] = useState(INITIAL_SUPPLIER_REVIEW);
  const [articleReview, setArticleReview] = useState(INITIAL_ARTICLE_REVIEW);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const importingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // Leaving the page can discard a preview. A confirmed write should finish.
      aliveRef.current = false;
      if (!importingRef.current) requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (phase !== "importing") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const isBusy = phase !== "idle";
  const preview = previews[mode];
  const result = results[mode];

  const supplierMode = mode === "supplier-references";

  async function send(targetMode: Mode, currentRows: CostingWorkbookRows, confirm: boolean, previewToken?: string): Promise<Outcome> {
    const supplierMode = targetMode === "supplier-references";
    let body: string;
    try {
      body = costingWorkbookImportBody(currentRows, confirm, previewToken);
    } catch (bodyError) {
      const message = bodyError instanceof CostingWorkbookFileError ? bodyError.message : UNREADABLE_FILE;
      return { ok: false, aborted: false, message, retry: false, stale: false };
    }
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(supplierMode ? ENDPOINT + "/supplier-references" : ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) return refusal(response.status, payload);
      const data = asRecord(payload)?.data;
      if (supplierMode) {
        const report = costingWorkbookSupplierReferenceReportSchema.safeParse(data);
        if (report.success) return { ok: true, report: report.data };
      } else if (isReport(data)) {
        return { ok: true, report: data };
      }
      return { ok: false, aborted: false, message: "Réponse inattendue du serveur. Réessayez dans un instant.", retry: true, stale: false };
    } catch {
      if (controller.signal.aborted) return { ok: false, aborted: true };
      return { ok: false, aborted: false, message: NETWORK_FAILURE, retry: true, stale: false };
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function refreshCatalogue() {
    try {
      await onImported();
    } catch {
      if (aliveRef.current) setError("Les brouillons sont créés, mais la liste n’a pas pu être actualisée.");
    }
  }

  async function runPreview(targetMode: Mode, currentRows: CostingWorkbookRows) {
    setPhase("previewing");
    setError(null);
    setCanRetry(false);
    const outcome = await send(targetMode, currentRows, false);
    if (!aliveRef.current || (!outcome.ok && outcome.aborted)) return;
    setPhase("idle");
    if (outcome.ok) {
      setPreviews((previous) => ({ ...previous, [targetMode]: outcome.report }));
    } else {
      setError(outcome.message);
      setCanRetry(outcome.retry);
    }
  }

  function changeMode(choice: Mode) {
    if (choice === mode || isBusy) return;
    setMode(choice);
    if (!rows) return;
    setError(null);
    setCanRetry(false);
    if (!previews[choice] && !results[choice]) void runPreview(choice, rows);
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setRows(null);
    setPreviews({});
    setResults({});
    setSupplierReview(INITIAL_SUPPLIER_REVIEW);
    setArticleReview(INITIAL_ARTICLE_REVIEW);
    setError(null);
    setCanRetry(false);
    if (!file) return;
    if (!/\.xls[xm]$/i.test(file.name)) {
      setError("Choisissez un fichier .xlsm ou .xlsx.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Ce fichier dépasse 20 Mo : ce n’est pas le classeur de chiffrage attendu.");
      return;
    }

    setPhase("reading");
    let nextRows: CostingWorkbookRows;
    try {
      nextRows = await readCostingWorkbookFile(await file.arrayBuffer());
    } catch (readError) {
      if (!aliveRef.current) return;
      setPhase("idle");
      setError(readError instanceof CostingWorkbookFileError ? readError.message : UNREADABLE_FILE);
      return;
    }
    if (!aliveRef.current) return;
    setRows(nextRows);
    await runPreview(mode, nextRows);
  }

  const supplierReport = result && "for_decision" in result
    ? result : preview && "for_decision" in preview ? preview : null;
  const articleResult = result && "new_articles" in result ? result : null;
  const articlePreview = preview && "new_articles" in preview ? preview : null;
  const toImport = articlePreview?.new_articles ?? supplierReport?.to_import ?? 0;

  async function runImport() {
    if (!rows || !preview || toImport === 0 || importingRef.current) return;
    importingRef.current = true;
    setPhase("importing");
    setError(null);
    setCanRetry(false);
    // A write can change the catalogue that the other mode's preview was based on.
    setPreviews({ [mode]: preview });
    const outcome = await send(mode, rows, true, supplierReport?.preview_token ?? undefined);
    importingRef.current = false;
    if (!outcome.ok && outcome.aborted) return;
    if (!aliveRef.current) {
      if (!supplierMode && (outcome.ok || outcome.stale)) await refreshCatalogue();
      return;
    }
    setPhase("idle");
    if (outcome.ok) {
      setPreviews({});
      setResults((previous) => ({ ...previous, [mode]: outcome.report }));
      if (!supplierMode) await refreshCatalogue();
      return;
    }
    setError(outcome.message);
    if (outcome.stale || (supplierMode && outcome.retry)) {
      // The catalogue may have changed, or the response may have been lost after a successful write.
      setPreviews({});
      setCanRetry(true);
      if (!supplierMode) await refreshCatalogue();
    }
  }

  const label = supplierMode ? (toImport > 1 ? "références" : "référence")
    : (toImport > 1 ? "brouillons" : "brouillon");

  return (
    <section aria-labelledby="costing-workbook-title" className="w-full min-w-0">
      <PageHeader
        title={<span id="costing-workbook-title">Importer le classeur de chiffrage</span>}
        breadcrumbs={[
          { label: "Référentiel", href: phase === "importing" ? undefined : "/dashboard/referentiel" },
          { label: "Produits", href: phase === "importing" ? undefined : catalogueHref },
          { label: "Import du classeur" },
        ]}
      />
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (value === "articles" || value === "supplier-references") changeMode(value);
        }}
        className="min-w-0 gap-4"
      >
        <div className="space-y-3 border-b border-border bg-background pb-3 xl:sticky xl:top-15 xl:z-10 xl:pt-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <TabsList aria-label="Type d’import" variant="line" className="h-auto! max-w-full flex-wrap justify-start p-0">
              <TabsTrigger value="articles" disabled={isBusy && supplierMode} className="min-h-9 px-3">
                Articles en brouillon
              </TabsTrigger>
              <TabsTrigger value="supplier-references" disabled={isBusy && !supplierMode} className="min-h-9 px-3">
                Références fournisseur
              </TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                id={FILE_INPUT_ID}
                type="file"
                accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="Fichier Excel"
                disabled={isBusy}
                onChange={(event) => void chooseFile(event)}
                hidden
              />
              <Button
                variant="outline"
                disabled={isBusy}
                leftIcon={<FileSpreadsheetIcon aria-hidden="true" />}
                onClick={() => fileInputRef.current?.click()}
              >
                {rows ? "Changer de fichier Excel" : "Choisir un fichier Excel"}
              </Button>
              {articleResult ? (
                <Link className={buttonVariants()} href={draftsHref}>
                  Voir les brouillons
                </Link>
              ) : null}
              {preview && !result ? (
                <Button
                  loading={phase === "importing"}
                  disabled={isBusy || toImport === 0}
                  onClick={() => void runImport()}
                >
                  {"Importer " + formatCount(toImport) + " " + label}
                </Button>
              ) : null}
            </div>
          </div>

          <div aria-live="polite" className="space-y-3 empty:hidden">
            {phase !== "idle" ? (
              <p className="flex items-center gap-2 text-sm text-info">
                <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                {supplierMode && phase === "importing" ? "Enregistrement des références…" : PHASE_LABELS[phase]}
              </p>
            ) : null}
            {error ? <Alert variant="danger">{error}</Alert> : null}
            {articleResult ? (
              <Alert variant="success">
                {articleResult.new_articles === 0
                  ? "Import terminé : aucun brouillon créé, rien de nouveau."
                  : `Import terminé : ${formatCount(articleResult.new_articles)} ${plural(articleResult.new_articles, "brouillon créé", "brouillons créés")}.`}
              </Alert>
            ) : null}
          </div>

          {canRetry && rows && !preview && phase === "idle" ? (
            <div>
              <Button variant="secondary" size="md" onClick={() => void runPreview(mode, rows)}>
                Réessayer
              </Button>
            </div>
          ) : null}

          {articleResult ? (
            <p className="text-sm text-foreground-secondary">
              Vérifiez chaque brouillon puis validez-le depuis le catalogue.
            </p>
          ) : null}

        </div>
        <TabsContent value="articles">
          {articlePreview && rows ? (
            <CostingWorkbookPreview report={articlePreview} rows={rows} review={articleReview} onReviewChange={setArticleReview} />
          ) : null}
        </TabsContent>
        <TabsContent value="supplier-references">
          {supplierReport && rows ? (
            <SupplierReferenceReport report={supplierReport} rows={rows} review={supplierReview} onReviewChange={setSupplierReview} />
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}

type ReviewChoice = { id: string; label: string; count: number };

function WorkbookReviewLayout({ groups, active, onSelect, children }: Readonly<{
  groups: ReviewChoice[][];
  active: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}>) {
  const menuId = useId();
  const visibleGroups = groups.filter((group) => group.length > 0);
  return (
    <div className={visibleGroups.length ? "grid min-w-0 items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]" : "min-w-0"}>
      {visibleGroups.length > 0 ? (
        <aside aria-label="Vues de l’aperçu" className="min-w-0 space-y-2 rounded-lg border border-border bg-surface-subtle p-2">
          {visibleGroups.map((group, index) => (
            <div key={group[0].id} className={index > 0 ? "grid gap-1 border-t border-border pt-2" : "grid gap-1"}>
              {group.map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === active}
                  aria-describedby={`${menuId}-${id}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary"
                  onClick={() => onSelect(id)}
                >
                  <span>{label}</span>
                  <span id={`${menuId}-${id}`} aria-hidden="true" className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatCount(count)}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
      ) : null}
      <div className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        {children}
      </div>
    </div>
  );
}

function ReviewPager({ page, total, onSelect, suffix = "" }: Readonly<{
  page: number;
  total: number;
  onSelect: (page: number) => void;
  suffix?: string;
}>) {
  if (total <= DECISIONS_PER_PAGE) return null;
  const start = page * DECISIONS_PER_PAGE;
  const end = Math.min(start + DECISIONS_PER_PAGE, total);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
        {`${formatCount(start + 1)}–${formatCount(end)} sur ${formatCount(total)}${suffix}`}
      </span>
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onSelect(page - 1)}>Précédente</Button>
      <Button variant="outline" size="sm" disabled={end >= total} onClick={() => onSelect(page + 1)}>Suivante</Button>
    </div>
  );
}

function CostingWorkbookPreview({ report, rows, review, onReviewChange }: Readonly<{
  report: CostingWorkbookImportReport;
  rows: CostingWorkbookRows;
  review: WorkbookReview;
  onReviewChange: (review: WorkbookReview) => void;
}>) {
  const { new_articles: newArticles, already_in_catalogue: already, supplier_references_not_imported: notImported } = report;
  const articleByRow = useMemo(
    () => new Map(readCostingWorkbookRows(rows).articles.map((article) => [article.row, article])),
    [rows],
  );
  const query = foldText(review.search.trim());
  const proposed = (report.proposed_articles ?? []).flatMap((proposal) => {
    const article = articleByRow.get(proposal.row);
    if (!article || (query && ![article.reference, article.designation].some((text) => foldText(text).includes(query)))) {
      return [];
    }
    return [{ ...proposal, article }];
  });
  const page = Math.min(review.page, Math.max(0, Math.ceil(proposed.length / DECISIONS_PER_PAGE) - 1));
  const start = page * DECISIONS_PER_PAGE;
  const choices: ReviewChoice[] = [{ id: "proposed", label: "Articles proposés", count: newArticles }];
  if (report.issue_count > 0) choices.push({ id: "issues", label: "Remarques sur le classeur", count: report.issue_count });
  const active = choices.some(({ id }) => id === review.view) ? review.view : "proposed";

  return (
    <section aria-labelledby="costing-workbook-preview-title">
      <h2 id="costing-workbook-preview-title" className="sr-only">Aperçu de l’import</h2>
      <WorkbookReviewLayout groups={[choices]} active={active} onSelect={(view) => onReviewChange({ ...review, page: 0, view })}>
        {active === "proposed" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="typo-h3">
                {newArticles === 0
                  ? "Aucun nouvel article en brouillon"
                  : `${formatCount(newArticles)} ${plural(newArticles, "nouvel article", "nouveaux articles")} en brouillon`}
              </h3>
              <ReviewPager page={page} total={proposed.length} onSelect={(nextPage) => onReviewChange({ ...review, page: nextPage })} />
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <li>{already === 0 ? "Aucun article déjà au catalogue" : `${formatCount(already)} déjà au catalogue (${plural(already, "inchangé", "inchangés")})`}</li>
              {report.without_supply_type > 0 ? <li>{`${formatCount(report.without_supply_type)} sans type de fourniture`}</li> : null}
              {notImported > 0 ? (
                <li>{`${formatCount(notImported)} ${plural(notImported, "référence fournisseur", "références fournisseur")} à traiter séparément.`}</li>
              ) : null}
            </ul>
            {Boolean(report.proposed_articles?.length) ? (
              <>
                <Input
                  type="search"
                  size="sm"
                  aria-label="Rechercher un article proposé"
                  placeholder="Référence ou désignation"
                  className="sm:max-w-84"
                  value={review.search}
                  onChange={(event) => onReviewChange({ ...review, search: event.currentTarget.value, page: 0 })}
                />
                <div className="overflow-x-auto rounded-md border border-border">
                  <table aria-label="Articles proposés en brouillon" className="w-full min-w-120 text-left text-sm">
                    <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
                      <tr className="[&>th]:px-3 [&>th]:py-2.5">
                        <th scope="col">Ligne Excel</th>
                        <th scope="col">Référence</th>
                        <th scope="col">Désignation</th>
                        <th scope="col">Unité</th>
                        <th scope="col">Type de fourniture</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {proposed.slice(start, start + DECISIONS_PER_PAGE).map(({ row, article, without_supply_type }) => (
                        <tr key={row} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5">
                          <td className="tabular-nums">{row}</td>
                          <td className="font-mono text-xs">{article.reference}</td>
                          <td>{article.designation}</td>
                          <td>{article.unit}</td>
                          <td>{without_supply_type ? "À préciser" : "Renseigné"}</td>
                        </tr>
                      ))}
                      {proposed.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">Aucun article ne correspond à la recherche.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <h3 className="typo-h3">
              {`${formatCount(report.issue_count)} ${plural(report.issue_count, "remarque", "remarques")} sur le classeur`}
            </h3>
            <ul aria-label="Remarques sur le classeur" className="divide-y divide-border rounded-md border border-border px-3 text-sm">
              {report.issues.map((issue, index) => (
                <li key={`${issue.row}-${index}`} className="break-words py-2">
                  {`Ligne ${issue.row}${issue.reference ? ` · ${issue.reference}` : ""} : ${issue.message}`}
                </li>
              ))}
            </ul>
            {report.issue_count > report.issues.length ? (
              <p className="text-xs text-muted-foreground">
                {`Les ${formatCount(report.issues.length)} premières sur ${formatCount(report.issue_count)}.`}
              </p>
            ) : null}
          </>
        )}
      </WorkbookReviewLayout>
    </section>
  );
}

const PRICE_SOURCE_LABELS: Record<CostingWorkbookPriceSourceKind, string> = {
  quote: "Devis",
  document: "Document",
  order: "Commande",
  regression: "Estimation par régression",
};

type WorkbookLocation = Pick<CostingWorkbookSupplierOccurrence, "row" | "slot">;
function WorkbookCell({ row, slot, column, field = `F${slot}_ref` }: Readonly<WorkbookLocation & { column?: number; field?: string }>) {
  const [feedback, setFeedback] = useState("");
  const address = column === undefined ? null : workbookCellAddress(row, column);

  async function copyCell() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setFeedback(`${address} copiée.`);
    } catch {
      setFeedback("Sélectionnez l’adresse pour la copier.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{`Ligne ${row} · ${field}`}</span>
      {address ? (
        <button type="button" aria-label={`Copier la cellule Excel ${address}`} title={`Copier ${address}`} onClick={() => void copyCell()}
          className="inline-flex items-center gap-1 rounded font-mono text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {address}<CopyIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
      <span aria-live="polite" className="basis-full empty:hidden">{feedback}</span>
    </div>
  );
}

function CorrectionCell({ decision, source }: Readonly<{ decision: SupplierDecision; source?: CostingWorkbookSupplierOccurrence }>) {
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

function articleContext(source: CostingWorkbookSupplierOccurrence | undefined) {
  return [...new Set([source?.article_wording, source?.article_material, source?.article_dimension].filter(Boolean))].join(" · ");
}

function CatalogueArticleLookup({ source, reason }: Readonly<{
  source?: CostingWorkbookSupplierOccurrence;
  reason: SupplierDecision["reason"];
}>) {
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
      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Chercher dans le catalogue <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </Link>
  );
}

function WorkbookSupplierComparisons({ title, comparisons }: Readonly<{
  title: string;
  comparisons: ReturnType<typeof compareCostingWorkbookSupplierValues>;
}>) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul aria-label={title} className="grid gap-3 2xl:grid-cols-2">
        {comparisons.map(({ key, articleReference, supplierName, values }) => {
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

function ProposedSupplierReferences({ proposed, sourceByCell }: Readonly<{
  proposed: NonNullable<CostingWorkbookSupplierReferenceReport["proposed"]>;
  sourceByCell: ReadonlyMap<string, CostingWorkbookSupplierOccurrence>;
}>) {
  return (
    <section className="space-y-3">
      <h3 className="typo-h3">
        {`${formatCount(proposed.length)} ${plural(proposed.length, "référence à importer", "références à importer")}`}
      </h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table aria-label="Références proposées à l’import" className="w-full min-w-120 table-fixed text-left text-sm">
          <thead className="border-y border-border text-xs text-foreground-secondary">
            <tr className="[&>th]:px-2 [&>th]:py-2">
              <th scope="col">Cellule</th>
              <th scope="col">Article</th>
              <th scope="col">Fournisseur</th>
              <th scope="col">Référence fournisseur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {proposed.map((entry) => {
              const key = `${entry.row}-${entry.slot}`;
              const source = sourceByCell.get(key);
              return (
                <tr key={key} className="align-top wrap-anywhere [&>td]:px-2 [&>td]:py-2">
                  <td><WorkbookCell row={entry.row} slot={entry.slot} column={source?.column} /></td>
                  <td>{entry.article_reference}</td>
                  <td>{entry.supplier_name}</td>
                  <td>{source?.supplier_sku || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SupplierReferenceReport({ report, rows, review, onReviewChange }: Readonly<{
  report: CostingWorkbookSupplierReferenceReport;
  rows: CostingWorkbookRows;
  review: WorkbookReview;
  onReviewChange: (review: WorkbookReview) => void;
}>) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<SupplierDecision["reason"] | null>(null);
  const { sourceByCell, comparisons } = useMemo(() => {
    const { supplierReferenceOccurrences } = readCostingWorkbookRows(rows);
    return {
      sourceByCell: new Map(supplierReferenceOccurrences.map((source) => [source.row + "-" + source.slot, source])),
      comparisons: compareCostingWorkbookSupplierValues(supplierReferenceOccurrences),
    };
  }, [rows]);
  const conflicts = comparisons.filter(({ values }) => values.filter((value) => !value.price_source_kind).length > 1);
  const priceComparisons = comparisons.filter(({ values }) => values.filter((value) => !value.price_source_kind).length < 2);
  const priceSources = report.for_decision.filter((entry) => entry.reason === "price_source_reference");
  const decisions = report.for_decision.filter((entry) =>
    entry.reason !== "price_source_reference" && entry.reason !== "conflicting_workbook_references");
  const countsByReason = new Map<SupplierDecision["reason"], number>();
  for (const { reason } of decisions) countsByReason.set(reason, (countsByReason.get(reason) ?? 0) + 1);
  const availableReasons = [...countsByReason.keys()]
    .sort((a, b) => (countsByReason.get(b) ?? 0) - (countsByReason.get(a) ?? 0)
      || WORKBOOK_CORRECTION_RULES[a].label.localeCompare(WORKBOOK_CORRECTION_RULES[b].label, "fr"));
  const decisionViews: ReviewChoice[] = decisions.length ? [{ id: "all", label: "Toutes à examiner", count: decisions.length }] : [];
  for (const reason of availableReasons) {
    decisionViews.push({ id: reason, label: WORKBOOK_CORRECTION_RULES[reason].label, count: countsByReason.get(reason) ?? 0 });
  }
  const resultViews: ReviewChoice[] = [];
  if (report.to_import > 0) resultViews.push({ id: "proposed", label: "Proposées à l’import", count: report.to_import });
  if (conflicts.length > 0) resultViews.push({ id: "conflicts", label: "Codes à départager", count: conflicts.length });
  if (priceSources.length || priceComparisons.length) {
    resultViews.push({ id: "prices", label: "Sources de prix", count: priceSources.length });
  }
  const active = [...decisionViews, ...resultViews].some(({ id }) => id === review.view)
    ? review.view : decisionViews[0]?.id ?? resultViews[0]?.id ?? "all";
  const activeReason = availableReasons.find((reason) => reason === active) ?? "";
  const search = foldText(review.search.trim());
  const filteredDecisions = decisions.filter((entry) => {
    if (activeReason && entry.reason !== activeReason) return false;
    if (!search) return true;
    const source = sourceByCell.get(entry.row + "-" + entry.slot);
    return source && [source.article_reference, source.supplier_name, source.supplier_sku].some((text) => foldText(text).includes(search));
  });
  const groupedByArticle = activeReason === "article_not_found";
  const decisionGroups = new Map<string, SupplierDecision[]>();
  for (const entry of filteredDecisions) {
    const cellKey = `${entry.row}-${entry.slot}`;
    const reference = groupedByArticle ? workbookReferenceKey(sourceByCell.get(cellKey)?.article_reference ?? "") : "";
    const groupKey = reference ? `article:${reference}` : `cell:${cellKey}`;
    const group = decisionGroups.get(groupKey);
    if (group) group.push(entry);
    else decisionGroups.set(groupKey, [entry]);
  }
  const decisionCount = filteredDecisions.length;
  const pageCount = Math.ceil(decisionGroups.size / DECISIONS_PER_PAGE);
  const currentPage = Math.min(review.page, Math.max(0, pageCount - 1));
  const pageStart = currentPage * DECISIONS_PER_PAGE;
  const planned = report.to_import;
  const imported = report.imported;
  const existing = report.already_registered;
  async function downloadCorrections() {
    if (!activeReason || !filteredDecisions.length || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportWorkbookCorrections(activeReason, filteredDecisions, sourceByCell);
    } catch {
      setExportError(activeReason);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="costing-workbook-supplier-report" className="min-w-0 space-y-3">
      <h2 id="costing-workbook-supplier-report" className="sr-only">
        {report.confirmed ? "Résultat de l’import" : "Aperçu de l’import"}
      </h2>
      {report.confirmed ? (
        <Alert variant="success">
          {formatCount(imported) + " " + plural(imported, "référence importée", "références importées") + ", à vérifier."}
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
        groups={[decisionViews, resultViews]}
        active={active}
        onSelect={(view) => {
          if (view !== active) onReviewChange({ ...review, view, page: 0 });
        }}
      >
        {active === "proposed" ? (
          report.proposed?.length
            ? <ProposedSupplierReferences proposed={report.proposed} sourceByCell={sourceByCell} />
            : <h3 className="typo-h3">{formatCount(planned) + " " + plural(planned, "référence", "références") + " à importer"}</h3>
        ) : null}
        {active === "conflicts" ? (
          <WorkbookSupplierComparisons title="Références produit à départager" comparisons={conflicts} />
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
                    const key = entry.row + "-" + entry.slot;
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
        {(active === "all" || activeReason) && decisions.length > 0 ? (
          <section aria-labelledby="costing-workbook-decisions-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="costing-workbook-decisions-title" aria-live="polite" className="text-sm font-semibold">
                {formatCount(decisionCount) + " " + plural(decisionCount, "référence à examiner", "références à examiner")}
              </h3>
              {groupedByArticle && decisionCount > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {`${formatCount(decisionGroups.size)} ${plural(decisionGroups.size, "article distinct", "articles distincts")}`}
                </span>
              ) : null}
              <ReviewPager
                page={currentPage}
                total={decisionGroups.size}
                onSelect={(page) => onReviewChange({ ...review, page })}
                suffix={groupedByArticle ? " articles" : ""}
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
              {activeReason ? (
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
              ) : null}
            </div>
            {exportError && exportError === activeReason ? (
              <Alert variant="danger">Le fichier Excel n’a pas pu être téléchargé. Réessayez.</Alert>
            ) : null}
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
                      <td colSpan={5} className="px-3 py-4 text-muted-foreground">Aucune référence ne correspond à la recherche.</td>
                    </tr>
                  ) : null}
                  {[...decisionGroups.entries()].slice(pageStart, pageStart + DECISIONS_PER_PAGE).map(([key, entries]) => {
                    const [entry] = entries;
                    const source = sourceByCell.get(`${entry.row}-${entry.slot}`);
                    const context = articleContext(source);
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
                                    const cellKey = `${occurrence.row}-${occurrence.slot}`;
                                    const cell = sourceByCell.get(cellKey);
                                    const contextAtCell = articleContext(cell);
                                    return (
                                      <li key={cellKey} className="grid gap-1 break-words py-2 sm:grid-cols-[8rem_1fr_1fr] sm:gap-3">
                                        <div>
                                          <CorrectionCell decision={occurrence} source={cell} />
                                          {cell && cell.article_reference !== source?.article_reference ? (
                                            <span className="text-xs text-muted-foreground">{cell.article_reference}</span>
                                          ) : null}
                                        </div>
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
                              <CatalogueArticleLookup source={source} reason={entry.reason} />
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={key} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5">
                        <td><CorrectionCell decision={entry} source={source} /></td>
                        <td>
                          <p>{source?.article_reference || "Sans ID"}</p>
                          {context ? <p className="text-xs text-muted-foreground">{context}</p> : null}
                          <CatalogueArticleLookup source={source} reason={entry.reason} />
                        </td>
                        <td>{source?.supplier_name || "Sans nom"}</td>
                        <td>{source?.supplier_sku || "—"}</td>
                        <td className="text-muted-foreground">{WORKBOOK_CORRECTION_RULES[entry.reason].label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {active === "all" && decisions.length === 0 ? (
          <h3 className="typo-h3">Aucune référence à examiner</h3>
        ) : null}
      </WorkbookReviewLayout>
    </section>
  );
}
