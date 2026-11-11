"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { launchDocumentsOf, type PageDocumentSource } from "@/lib/takeoff/page-contributions";
import { fetchLaunchPageContributions, fetchTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-client";
import type { TakeoffPageContributionsResponse } from "@/lib/takeoff/page-contributions-contracts";
import { cn } from "@/lib/utils";

// TI-682 lot D, PR 1: « a plan page enters an estimate once ». Nothing yet replaces an earlier measure: these
// notices only say, before the last click, which pages of this takeoff the estimate already holds from another one
// (the page, that takeoff, how many estimate lines it brought). They decide nothing and block nothing.

type Item = { id: string; is_excluded: boolean; rule_results?: ReadonlyArray<{ rule: string; status: string; details?: unknown }> | null };
type Read = { data: TakeoffPageContributionsResponse | null; error: string | null };
type Page = TakeoffPageContributionsResponse["pages"][number];
type Job = TakeoffPageContributionsResponse["jobs"][number];

const TITLE = "Pages déjà au devis";
const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

function pageLabel(page: Page) {
  return `${page.file_name ?? "Plan sans nom"}, ${page.page === null ? "page inconnue" : `page ${page.page}`}`;
}

function takeoffLabel(job: Job | undefined) {
  if (!job) return "un autre métré";
  const date = new Date(job.created_at);
  return `le métré du ${Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date)}${job.source_file_name ? ` (${job.source_file_name})` : ""}`;
}

/**
 * The read of the pages of a takeoff the estimate version under review already holds from another (`versionId`: the
 * version the review shows, the takeoff's own or a copy it was carried over into); none while `jobId` is null.
 * Read again once the takeoff is applied: the read taken before holds none of its lines, and the page it just added
 * again would stay hidden; the earlier read is not shown meanwhile. Read again too at each `revision` (a line's source
 * page saved): the page compared has changed. The earlier read stays shown until then; it was right a moment ago.
 */
export function useTakeoffJobPageContributions(jobId: string | null, versionId: string,
  options: { applied?: boolean; revision?: number } = {}): Read {
  const base = jobId ? `${jobId}:${versionId}:${options.applied ? "applied" : "open"}` : null;
  const key = base ? `${base}:${options.revision ?? 0}` : null;
  const [read, setRead] = useState<Read & { key: string | null; base: string | null }>({ key: null, base: null, data: null, error: null });
  useEffect(() => {
    if (!key || !jobId) return;
    const controller = new AbortController();
    void fetchTakeoffJobPageContributions(jobId, versionId, { signal: controller.signal }).then(
      (data) => setRead({ key, base, data, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setRead({ key, base, data: null, error: error instanceof Error ? error.message : "Vérification indisponible." });
      });
    return () => controller.abort();
  }, [base, jobId, key, versionId]);
  return base && read.base === base ? { data: read.data, error: read.error } : { data: null, error: null };
}

/**
 * The pages to show now: a page stays while one of this takeoff's lines on it is included (an excluded line
 * brings nothing to the estimate). Without the lines, every page reported. Once this takeoff is applied, only the
 * pages where its own lines are still in the estimate are there twice; elsewhere the estimate holds one measure.
 */
export function pagesToShow(data: TakeoffPageContributionsResponse | null, items?: readonly Item[], applied = false) {
  if (!data) return { pages: [] as Page[], unidentified: 0, zoneOverlap: false };
  const included = items ? new Set(items.filter((item) => !item.is_excluded).map((item) => item.id)) : null;
  const pages = data.pages.filter((page) => (applied ? page.own_line_count > 0
    : included ? page.item_ids.some((id) => included.has(id)) : true));
  // The earlier takeoffs' own lines on each line's pages: a Z1/Z2 duplicate whose partner is one of them is this page
  // read twice. The partner's takeoff alone proves nothing: it may have read another page (another zone) as well.
  const sameLine = (jobId: string, itemId: string) => `${jobId.toLowerCase()}:${itemId.toLowerCase()}`;
  const earlierLinesOf = new Map<string, Set<string>>();
  for (const page of pages) for (const id of page.item_ids) {
    const lines = earlierLinesOf.get(id) ?? new Set<string>();
    for (const earlier of page.earlier) for (const itemId of earlier.takeoff_item_ids) lines.add(sameLine(earlier.job_id, itemId));
    earlierLinesOf.set(id, lines);
  }
  const partnerLines = (details: unknown) => {
    const partners = details && typeof details === "object" ? (details as { partners?: unknown }).partners : null;
    return Array.isArray(partners) ? partners.flatMap((partner) => {
      const { job_id: jobId, item_id: itemId } = (partner ?? {}) as { job_id?: unknown; item_id?: unknown };
      return typeof jobId === "string" && typeof itemId === "string" ? [sameLine(jobId, itemId)] : [];
    }) : [];
  };
  return {
    pages,
    // Only meaningful when another takeoff is in the estimate: those lines could not be compared to it.
    unidentified: data.other_takeoff_line_count > 0
      ? data.unidentified_item_ids.filter((id) => (included ? included.has(id) : true)).length : 0,
    // A Z1/Z2 duplicate of a line of those pages with a line the earlier takeoff read on that page: one page read
    // twice, not two zones. Nothing is said when the partner cannot be placed on the page.
    zoneOverlap: (items ?? []).some((item) => !item.is_excluded && (item.rule_results ?? []).some((result) =>
      result.rule === "zone_overlap" && result.status === "fail"
      && partnerLines(result.details).some((line) => earlierLinesOf.get(item.id)?.has(line)))),
  };
}

function PageRows({ data, pages, jobHref }: Readonly<{ data: TakeoffPageContributionsResponse; pages: readonly Page[]; jobHref?: (job: Job) => string }>) {
  const jobs = new Map(data.jobs.map((job) => [job.id, job]));
  return (
    <ul aria-label="Pages concernées" className="max-h-40 space-y-1 overflow-y-auto">
      {pages.map((page, index) => (
        // Two documents of the same name are two rows of the same label: the position tells them apart.
        <li key={`${index}:${page.file_name ?? ""}:${page.page ?? "?"}`} className="text-foreground-secondary">
          <span className="font-medium text-foreground">{pageLabel(page)}</span>
          {" : déjà au devis par "}
          {page.earlier.map((earlier, index) => {
            const job = jobs.get(earlier.job_id);
            return (
              <span key={earlier.job_id}>
                {index > 0 ? " et par " : null}
                {takeoffLabel(job)}, {plural(earlier.line_count, "ligne")}
                {job && jobHref ? (
                  <>
                    {" "}
                    <Link href={jobHref(job)} className="text-primary underline-offset-4 hover:underline">Ouvrir le métré</Link>
                  </>
                ) : null}
              </span>
            );
          })}
          .
        </li>
      ))}
    </ul>
  );
}

function Frame({ className, children }: Readonly<{ className?: string; children: React.ReactNode }>) {
  return (
    <section aria-label={TITLE} className={cn("flex items-start gap-3 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm", className)}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <h2 className="font-semibold text-foreground">{TITLE}</h2>
        {children}
      </div>
    </section>
  );
}

function NotCompared({ count }: Readonly<{ count: number }>) {
  return count > 0 ? <p className="text-xs text-muted-foreground">{plural(count, "ligne")} de ce métré sans plan ni page : non comparée{count > 1 ? "s" : ""}.</p> : null;
}

/** Both reviews (targeted and complete): a banner at the head, one row per page, with a link to the earlier takeoff. */
export function TakeoffPagesAlreadyInEstimateBanner({ read, items, applied, jobHref, className }: Readonly<{
  read: Read; items: readonly Item[]; applied: boolean; jobHref: (job: Job) => string; className?: string;
}>) {
  const shown = useMemo(() => pagesToShow(read.data, items, applied), [applied, items, read.data]);
  if (read.error) return <p className={cn("text-xs text-muted-foreground", className)}>Vérification des pages déjà au devis indisponible.</p>;
  if (!read.data || (shown.pages.length === 0 && shown.unidentified === 0)) return null;
  if (shown.pages.length === 0) return <div className={className}><NotCompared count={shown.unidentified} /></div>;
  return (
    <Frame className={className}>
      <PageRows data={read.data} pages={shown.pages} jobHref={jobHref} />
      <p className="text-foreground-secondary">
        {applied
          ? "Ce métré est déjà appliqué : ces pages sont au devis deux fois. Retirez du devis les lignes en double."
          : "Appliquer ce métré ajouterait ces pages une seconde fois : rien ne retire encore la mesure précédente. Pour remesurer une page, retirez d’abord du devis les lignes du métré précédent."}
      </p>
      {shown.zoneOverlap ? (
        <p className="text-foreground-secondary">
          Un doublon entre zones signalé ici avec une ligne du métré précédent compare deux lectures de la même page : ce n’est pas une autre zone, ne retirez pas la ligne pour le régler.
        </p>
      ) : null}
      <NotCompared count={shown.unidentified} />
    </Frame>
  );
}

/** What the chosen strategy does to the earlier measure of those pages (nothing yet replaces a page as a whole). */
const STRATEGY_EFFECT = {
  append: "Confirmer ajoutera ces pages une seconde fois au devis, à côté de la mesure précédente.",
  merge: "Fusionner ne remplace que les lignes de même désignation et de même unité : les autres seront ajoutées à côté de la mesure précédente.",
  replace: "Remplacer vide seulement la section cible : les lignes du métré précédent rangées dans une autre section resteront au devis.",
} as const;

/** The apply wizard: the same pages, without links, and no decision to take yet. */
export function TakeoffPagesAlreadyInEstimateNotice({ read, items, strategy }: Readonly<{
  read: Read; items?: readonly Item[]; strategy: keyof typeof STRATEGY_EFFECT;
}>) {
  const shown = useMemo(() => pagesToShow(read.data, items), [items, read.data]);
  if (read.error) return <p className="text-xs text-muted-foreground">Vérification des pages déjà au devis indisponible.</p>;
  if (!read.data || shown.pages.length === 0) return null;
  return (
    <Frame>
      <PageRows data={read.data} pages={shown.pages} />
      <p className="text-foreground-secondary">{STRATEGY_EFFECT[strategy]}</p>
      <NotCompared count={shown.unidentified} />
    </Frame>
  );
}

/** The launch: the plans and pages about to be read that the target version already holds. */
export function TakeoffLaunchPagesNotice({ versionId, sources }: Readonly<{
  versionId: string | null;
  sources: ReadonlyArray<PageDocumentSource & { document_name: string; pages: readonly number[] }>;
}>) {
  const documents = useMemo(() => launchDocumentsOf(sources), [sources]);
  const key = versionId && documents.length ? JSON.stringify([versionId, documents]) : null;
  const [read, setRead] = useState<Read & { key: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!key) return;
    const [estimateVersionId, launchDocuments] = JSON.parse(key) as [string, typeof documents];
    const controller = new AbortController();
    void fetchLaunchPageContributions({ estimate_version_id: estimateVersionId, documents: launchDocuments }, { signal: controller.signal }).then(
      (data) => setRead({ key, data, error: null }),
      (error: unknown) => { if (!controller.signal.aborted) setRead({ key, data: null, error: error instanceof Error ? error.message : "Vérification indisponible." }); });
    return () => controller.abort();
  }, [key]);
  if (!key || read.key !== key) return null;
  if (read.error) return <p className="text-xs text-muted-foreground">Vérification des pages déjà au devis indisponible.</p>;
  if (!read.data || read.data.pages.length === 0) return null;
  return (
    <Frame>
      <PageRows data={read.data} pages={read.data.pages} />
      <p className="text-foreground-secondary">Vous pouvez lancer ce métré ; à l’application, ces pages seraient ajoutées une seconde fois au devis, à côté de la mesure précédente.</p>
    </Frame>
  );
}
