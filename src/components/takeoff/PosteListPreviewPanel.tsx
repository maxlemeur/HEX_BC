import Link from "next/link";

import { JourneyPanel } from "@/components/journey/JourneyPage";
import { loadPosteListPreview } from "@/lib/takeoff/poste-list-preview-server";

const PAGE_SIZE = 25;
const ISSUE_LABELS = {
  missing_mapping: "Correspondance manquante",
  multiple_mappings: "Plusieurs correspondances",
  unattested_mapping: "Ligne source non retrouvée",
  invalid_quantity: "Quantité de référence à vérifier",
  ambiguous: "Nature de la ligne à préciser",
  section: "Section",
  footer: "Total ou pied de tableau",
  empty: "Sans désignation",
  header: "En-tête répété",
  unreadable_designation: "Désignation illisible",
};
const referenceFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
type Query = Record<string, string | string[] | undefined>;

function sourceLocation(origin: {
  rowIndex: number | null;
  sourceRowNumber?: number | null;
  sourcePage?: number | null;
  sheetName?: string | null;
  reference?: string | null;
}, sourceFormat: string | undefined) {
  const csv = sourceFormat === "csv";
  const line = !csv && origin.sourceRowNumber
    ? `${sourceFormat === "xlsx" ? "Ligne du tableau" : "Ligne"} ${origin.sourceRowNumber}`
    : origin.rowIndex === null ? "Ligne mappée"
      : `${csv ? "Enregistrement importé" : "Ligne importée"} ${origin.rowIndex + 1}`;
  return [
    origin.sheetName,
    origin.sourcePage ? `Page ${origin.sourcePage}` : null,
    line,
    origin.reference,
  ].filter(Boolean).join(" · ");
}

export async function PosteListPreviewPanel({ projectId, query }: { projectId: string; query: Query }) {
  const preview = await loadPosteListPreview(projectId).catch(() => ({ kind: "unavailable" } as const));
  const sourceFormat = "sourceFormat" in preview ? preview.sourceFormat : undefined;
  const limited = preview.kind === "limited" || ("limitedVisibility" in preview && preview.limitedVisibility);
  const ready = preview.kind === "template" || preview.kind === "dpgf";
  const projection = preview.kind === "dpgf" || preview.kind === "prepare" ? preview.projection : undefined;
  const items = ready ? preview.revision.items : [];
  const issueCount = projection?.issues.length ?? 0;
  const pageCount = Math.max(1, Math.ceil((items.length + issueCount) / PAGE_SIZE));
  const requestedPage = Number(query.postesPage);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const affaireHref = `/dashboard/affaires/${projectId}`;
  const pageHref = (target: number) => ({
    pathname: `${affaireHref}/takeoff`, query: { ...query, postesPage: target }, hash: "postes-a-mesurer",
  });

  return (
    <JourneyPanel headingId="postes-a-mesurer" title="Aperçu des postes à mesurer">
      <div className="journey-panel-body space-y-3">
        {preview.kind === "template" && (
          <p className="text-sm">Gabarit indicatif de plomberie · {items.length} postes</p>
        )}
        {preview.kind === "dpgf" && <p className="text-sm">DPGF · {preview.filename}</p>}
        {projection && (
          <p className="text-sm">Liste indicative. Les choix faits à la confirmation de l’import ne sont pas encore reflétés.</p>
        )}
        {(preview.kind === "prepare" || preview.kind === "choose") && (
          <p className="text-sm">
            {preview.kind === "choose" ? "Plusieurs sources DPGF dans cette affaire." : "DPGF à préparer."}{" "}
            <Link href={affaireHref} className="underline">Ouvrir le dossier de l’affaire</Link>
          </p>
        )}
        {limited && (
          <p className="text-sm">Cet aperçu est indicatif. Un DPGF peut exister sans être visible par votre compte.</p>
        )}
        {preview.kind === "unavailable" && <p className="text-sm">L’aperçu des postes est indisponible.</p>}
        {projection && (
          <p className="text-sm text-muted-foreground">
            {projection.counts.source} lignes sources · {projection.counts.useful} postes ·{" "}
            {projection.counts.ambiguous} ambiguës · {projection.counts.missing} sans correspondance ·{" "}
            {projection.counts.omitted} hors liste
            {projection.counts.orphaned > 0 && ` · ${projection.counts.orphaned} sans ligne source`}
          </p>
        )}
        {start < items.length && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm" aria-label="Postes à mesurer">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="px-2 py-2">Poste</th>
                  <th scope="col" className="px-2 py-2">Section</th>
                  <th scope="col" className="px-2 py-2">Unité</th>
                  {preview.kind === "dpgf" && <>
                    <th scope="col" className="px-2 py-2">Référence quantitative</th>
                    <th scope="col" className="px-2 py-2">Source</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {items.slice(start, end).map((item) => (
                  <tr key={item.id} id={`poste-${item.id}`} className="border-b align-top">
                    <th scope="row" className="px-2 py-2 font-medium">{item.label}</th>
                    <td className="px-2 py-2">{item.sections.map(({ title }) => title).join(" / ") || "—"}</td>
                    <td className="px-2 py-2">{item.expectedUnit ?? "À préciser"}</td>
                    {item.origin.kind === "dpgf" && <>
                      <td className="px-2 py-2">{item.referenceQuantity === null ? "—" : referenceFormat.format(item.referenceQuantity)}</td>
                      <td className="px-2 py-2">{sourceLocation(item.origin, sourceFormat)}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {projection && issueCount > 0 && end > items.length && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Détail de la lecture des lignes sources</summary>
            <ul className="list-disc space-y-1 pl-6 pt-2 text-sm">
              {projection.issues.slice(Math.max(0, start - items.length), end - items.length).map((issue) => (
                <li key={`${issue.rawRowId}:${issue.mappedRowId}:${issue.reason}`}>
                  {issue.title || sourceLocation(issue, sourceFormat)}
                  {" · "}{ISSUE_LABELS[issue.reason]}
                </li>
              ))}
            </ul>
          </details>
        )}
        {pageCount > 1 && (
          <nav aria-label="Pagination de l’aperçu des postes" className="flex flex-wrap items-center gap-4 text-sm">
            <span>Page {page} sur {pageCount}</span>
            {page > 1 && <Link href={pageHref(page - 1)} prefetch={false} className="underline">Page précédente</Link>}
            {page < pageCount && <Link href={pageHref(page + 1)} prefetch={false} className="underline">Page suivante</Link>}
          </nav>
        )}
      </div>
    </JourneyPanel>
  );
}
