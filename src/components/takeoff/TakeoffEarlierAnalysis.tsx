import { JourneyPageHeader, JourneyPanel } from "@/components/journey/JourneyPage";
import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";
import { buttonVariants } from "@/components/ui/button";
import { formatTakeoffCompletionDate } from "@/lib/takeoff/completion-outcome";
import {
  earlierAnalysisHref,
  earlierAnalysisReturnHref,
  EARLIER_ANALYSIS_STATUS_LABELS,
  type EarlierAnalysisView,
} from "@/lib/takeoff/earlier-analysis";
import { listEarlierTakeoffAnalyses } from "@/lib/takeoff/earlier-analysis-server";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { QUANTITY_FORMAT as quantity } from "@/lib/format/fr";

/**
 * « Analyse antérieure » on the affaire's takeoff page (lot 4, earlier-analysis.ts): beside the table of items, the
 * affaire's analyses that were not read against its list, once it has one; and each of them, read only, as it was kept.
 * Its review (and its send) stays one link away, as today.
 */

const status = (value: string) => EARLIER_ANALYSIS_STATUS_LABELS[value] ?? "État inconnu";

/** The earlier analyses beside the table of items; nothing before the affaire has a list, or without any. */
export async function TakeoffEarlierAnalysesPanel({ projectId, query }: { projectId: string; query: URLSearchParams }) {
  let earlier: Awaited<ReturnType<typeof listEarlierTakeoffAnalyses>>;
  try {
    earlier = await listEarlierTakeoffAnalyses(projectId);
  } catch (error) {
    // A refused access is the table's to say; any other failure is said here, the table and the page left as they are.
    if (error !== null && typeof error === "object" && "status" in error && [403, 404].includes((error as { status: number }).status)) return null;
    return (
      <JourneyPanel headingId="analyses-anterieures" title="Analyses antérieures">
        <p className="journey-panel-body text-sm text-danger">Les analyses antérieures de l’affaire n’ont pas pu être lues : rechargez la page.</p>
      </JourneyPanel>
    );
  }
  if (!earlier || earlier.entries.length === 0) return null;
  return (
    <JourneyPanel headingId="analyses-anterieures" title="Analyses antérieures">
      <div className="journey-panel-body space-y-2 text-sm">
        <p>
          Ces analyses de l’affaire n’ont pas été lues contre la liste des postes : elles se consultent telles qu’elles ont été
          conservées, sans couverture des postes.
        </p>
        <ul className="divide-y divide-slate-200" aria-label="Analyses antérieures de l’affaire">
          {earlier.entries.map((entry) => (
            <li key={entry.jobId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {entry.fileName ?? "Analyse sans nom"} · niveau {entry.level} · {status(entry.status)} ·{" "}
                <time dateTime={entry.at}>{formatTakeoffCompletionDate(entry.at)}</time>
              </span>
              <Link href={earlierAnalysisHref(projectId, entry.jobId, query)} className="underline"
                aria-label={`Voir l’analyse antérieure ${entry.fileName ?? "sans nom"}`}>
                Voir l’analyse antérieure
              </Link>
            </li>
          ))}
        </ul>
        {earlier.more ? <p className="text-muted-foreground">Les plus anciennes sont dans « Suivi des analyses ».</p> : null}
      </div>
    </JourneyPanel>
  );
}

/** One earlier analysis, read only. */
export function TakeoffEarlierAnalysisScreen({ projectId, projectName, view, query }: { projectId: string; projectName: string;
  view: EarlierAnalysisView; query: URLSearchParams }) {
  const back = earlierAnalysisReturnHref(projectId, query);
  const name = view.fileName ?? "Analyse sans nom";
  return (
    <div className="space-y-4" data-testid="analyse-anterieure">
      <JourneyPageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: projectName, href: `/dashboard/affaires/${projectId}` },
          { label: "Métrés", href: back },
          { label: "Analyse antérieure" },
        ]}
        title="Analyse antérieure"
        stage="Étude"
        context="Une analyse de l’affaire qui n’a pas été lue contre la liste des postes, telle qu’elle a été conservée."
        actions={(
          <div className="flex flex-wrap gap-2">
            {view.reviewable ? (
              <Link href={takeoffReviewHref({ projectId, jobId: view.jobId, versionId: view.versionId })} className={buttonVariants({ variant: "outline" })}>
                Ouvrir sa revue
              </Link>
            ) : null}
            <Link href={back} className={buttonVariants({ variant: "ghost" })}>Revenir aux postes</Link>
          </div>
        )}
      />
      <JourneyPanel headingId="analyse-anterieure-faits" title={name}>
        <div className="journey-panel-body space-y-3 text-sm">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt>État</dt><dd>{status(view.status)}</dd>
            <dt>Niveau</dt><dd>{view.level}</dd>
            {view.provider ? <><dt>Fournisseur</dt><dd>{view.provider}</dd></> : null}
            <dt>Lancée le</dt><dd><time dateTime={view.startedAt}>{formatTakeoffCompletionDate(view.startedAt)}</time></dd>
            {view.finishedAt ? <><dt>Terminée le</dt><dd><time dateTime={view.finishedAt}>{formatTakeoffCompletionDate(view.finishedAt)}</time></dd></> : null}
            {view.failure ? <><dt>Échec</dt><dd>{view.failure}</dd></> : null}
            <dt>Liste des postes</dt><dd>Liste demandée non enregistrée</dd>
            <dt>Couverture</dt><dd>Couverture inconnue</dd>
          </dl>
          <p>
            Cette analyse n’a pas été lue contre la liste des postes : la liste qu’elle devait mesurer n’a pas été enregistrée, et ce
            qu’elle a couvert n’est pas connu. Rien n’y est complété d’après la liste ou le gabarit d’aujourd’hui, aucun poste n’y
            est dit non trouvé et aucune ligne n’y est dite vérifiée.
            {view.reviewable ? " Sa revue, où se fait son envoi au devis, reste ouverte comme avant." : ""}
          </p>
        </div>
      </JourneyPanel>
      <JourneyPanel headingId="analyse-anterieure-lignes" title={`Contributions observées (${view.rowsTotal})`}>
        <div className="journey-panel-body overflow-x-auto text-sm">
          {view.rows.length === 0 ? <p>Cette analyse n’a conservé aucune ligne.</p> : (
            <table className="w-full text-left" aria-labelledby="analyse-anterieure-lignes">
              <thead>
                <tr><th scope="col">Désignation</th><th scope="col">Quantité</th><th scope="col">Unité</th><th scope="col">Page</th>
                  <th scope="col">Fichier</th><th scope="col">Écartée</th></tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.designation}</td><td>{quantity.format(row.quantity)}</td><td>{row.unit}</td><td>{row.page ?? "—"}</td>
                    <td>{row.fileName ?? "—"}</td><td>{row.setAside ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view.rowsTotal > view.rows.length ? (
            <p className="mt-2 text-muted-foreground">
              Les {view.rows.length} premières lignes sur {view.rowsTotal} : les autres se consultent dans sa revue.
            </p>
          ) : null}
        </div>
      </JourneyPanel>
      <JourneyPanel headingId="analyse-anterieure-tableaux" title={`Tableaux extraits (${view.tables.length})`}>
        <div className="journey-panel-body space-y-3 overflow-x-auto text-sm">
          {view.tables.length === 0 ? <p>Cette analyse n’a conservé aucun tableau.</p> : view.tables.map((table, index) => (
            <table key={index} className="w-full text-left">
              <caption className="text-left font-medium">{table.title ?? `Tableau ${index + 1}`}{table.page ? ` · page ${table.page}` : ""}</caption>
              <thead><tr>{table.headers.map((header, column) => <th key={column} scope="col">{header}</th>)}</tr></thead>
              <tbody>{table.rows.map((cells, row) => <tr key={row}>{cells.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
            </table>
          ))}
        </div>
      </JourneyPanel>
      <JourneyPanel headingId="analyse-anterieure-avertissements" title={`Avertissements (${view.warnings.length + view.unreadableWarnings})`}>
        <div className="journey-panel-body text-sm">
          {view.warnings.length + view.unreadableWarnings === 0 ? <p>Cette analyse n’a conservé aucun avertissement.</p> : (
            <ul className="list-disc space-y-1 pl-5">
              {view.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}
              {view.unreadableWarnings > 0 ? (
                <li>{view.unreadableWarnings} avertissement{view.unreadableWarnings > 1 ? "s" : ""} conservé{view.unreadableWarnings > 1 ? "s" : ""} dans un format que cette version ne lit pas.</li>
              ) : null}
            </ul>
          )}
        </div>
      </JourneyPanel>
    </div>
  );
}
