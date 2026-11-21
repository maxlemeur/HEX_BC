import Link from "next/link";

import { JourneyPanel } from "@/components/journey/JourneyPage";
import { TakeoffItemListAddForm, TakeoffItemListProposalForm } from "@/components/takeoff/TakeoffItemListActions";
import { loadAffaireItemList, loadAffaireItemListSummary, type AffaireItemListView } from "@/lib/takeoff/item-list-server";
import type { ItemListPrepareReason } from "@/lib/takeoff/item-list-sources-server";
import type { Poste } from "@/lib/takeoff/poste-list";

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
  ignored: "Ignorée à la confirmation de l’import",
};
const PREPARE_LABELS: Record<ItemListPrepareReason, string> = {
  document_without_import: "DPGF à préparer : la pièce du dossier n’est pas encore importée.",
  import_in_progress: "DPGF à préparer : l’import est en cours.",
  import_failed: "DPGF à préparer : l’import a échoué, importez de nouveau la DPGF.",
  mapping_missing: "DPGF à préparer : choisissez les colonnes de l’import.",
  mapping_draft: "DPGF à préparer : la correspondance des colonnes n’est pas validée.",
  rows_incomplete: "DPGF à préparer : les lignes de l’import sont incomplètes.",
  rows_unattested: "DPGF à préparer : des lignes de l’import n’ont pas de correspondance.",
  document_mismatch: "DPGF à préparer : l’import ne correspond plus à la pièce du dossier.",
};
const CAUSE_LABELS = { initial: "Première liste", proposal: "Révision acceptée", item_added: "Poste ajouté" };
const referenceFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
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
  return [origin.sheetName, origin.sourcePage ? `Page ${origin.sourcePage}` : null, line, origin.reference]
    .filter(Boolean).join(" · ");
}

function originText(item: Poste, list: AffaireItemListView, sourceFormat: string | undefined) {
  const { origin } = item;
  if (origin.kind === "dpgf") return sourceLocation(origin, sourceFormat);
  if (origin.kind === "template") return `Gabarit, version ${origin.version}`;
  const author = list.names[origin.addedBy];
  return `Ajouté${author ? ` par ${author}` : ""} le ${dateFormat.format(new Date(origin.addedAt))}`;
}

function sectionPath(item: Poste) {
  return item.sections.map(({ title }) => title).join(" / ");
}

function SourceLine({ list }: { list: AffaireItemListView }) {
  const { sources } = list;
  if (sources.kind === "template") {
    const { template } = sources;
    const by = template.publishedBy ? list.names[template.publishedBy] : null;
    return (
      <p className="text-sm">
        Gabarit {template.title} · version {template.version}
        {template.publishedAt
          ? ` publiée le ${dateFormat.format(new Date(template.publishedAt))}${by ? ` par ${by}` : ""}`
          : " livrée avec l’application"}
      </p>
    );
  }
  if (sources.kind === "dpgf") {
    const decisions = sources.decisions.status === "applied"
      ? "Choix de structure de la confirmation de l’import appliqués."
      : sources.decisions.status === "stale"
        ? "Les choix de structure enregistrés ne correspondent plus à l’import : confirmez de nouveau l’import pour les reprendre."
        : "Import confirmé avant l’enregistrement des choix de structure : les titres sont lus tels quels.";
    return <><p className="text-sm">DPGF · {sources.filename}</p><p className="text-sm">{decisions}</p></>;
  }
  const affaireHref = `/dashboard/affaires/${list.projectId}`;
  return (
    <p className="text-sm">
      {sources.kind === "choose"
        ? "Plusieurs DPGF dans cette affaire : gardez-en une seule pour que la liste en soit tirée."
        : PREPARE_LABELS[sources.reason]}{" "}
      <Link href={affaireHref} className="underline">Ouvrir le dossier de l’affaire</Link>
    </p>
  );
}

/**
 * The affaire's item list, for any of its readers: where it comes from, the revision stored, the revision the sources
 * propose (accepted by an operator, never applied on its own) and the items. `compact` keeps one line on the takeoff
 * page of an affaire that already has an estimate, with a link to the whole list.
 */
export async function TakeoffItemListPanel({ projectId, query, compact = false }: {
  projectId: string; query: Query; compact?: boolean;
}) {
  const href = `/dashboard/affaires/${projectId}/takeoff`;
  if (compact && query.postes !== "liste") {
    // One line from the stored revision: the sources and the proposal are read when the whole list is opened.
    const summary = await loadAffaireItemListSummary(projectId).catch(() => null);
    return (
      <p className="text-sm">
        Liste des postes · {summary?.revision ? `révision ${summary.revision} · ${summary.itemCount} postes` : "non enregistrée"}{" "}
        <Link href={{ pathname: href, query: { ...query, postes: "liste" }, hash: "postes-a-mesurer" }} className="underline">
          Voir la liste des postes
        </Link>
      </p>
    );
  }
  const list = await loadAffaireItemList(projectId).catch(() => null);
  if (!list) {
    return (
      <JourneyPanel headingId="postes-a-mesurer" title="Postes à mesurer">
        <div className="journey-panel-body"><p className="text-sm">La liste des postes est indisponible.</p></div>
      </JourneyPanel>
    );
  }
  const items = list.current?.items ?? list.proposal?.items ?? [];

  const sourceFormat = list.sources.kind === "dpgf" || list.sources.kind === "prepare"
    ? list.sources.sourceFormat ?? undefined : undefined;
  const projection = list.sources.kind === "dpgf" || list.sources.kind === "prepare" ? list.sources.projection : null;
  const issueCount = projection?.issues.length ?? 0;
  const pageCount = Math.max(1, Math.ceil((items.length + issueCount) / PAGE_SIZE));
  const requestedPage = Number(query.postesPage);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageHref = (target: number) => ({ pathname: href, query: { ...query, postesPage: target }, hash: "postes-a-mesurer" });
  const expectedRevision = list.current?.revision ?? 0;
  const proposal = list.proposal;
  const byId = new Map([...(list.current?.items ?? []), ...(proposal?.items ?? [])].map((item) => [item.id, item]));
  const sectionChoices = [...new Map((list.current?.items ?? []).filter(({ sections }) => sections.length)
    .map((item) => [sectionPath(item), { itemId: item.id, label: sectionPath(item) }])).values()];
  const author = list.current ? list.names[list.current.created_by] : null;

  return (
    <JourneyPanel headingId="postes-a-mesurer" title="Postes à mesurer">
      <div className="journey-panel-body space-y-3">
        <SourceLine list={list} />
        {list.current ? (
          <p className="text-sm">
            Liste enregistrée · révision {list.current.revision} · {list.current.items.length} postes · le{" "}
            {dateFormat.format(new Date(list.current.created_at))}{author ? ` par ${author}` : ""}
          </p>
        ) : proposal ? (
          <p className="text-sm">
            {list.sources.kind === "template" ? "Gabarit indicatif de plomberie" : "Liste proposée"} · {proposal.items.length} postes,
            non enregistrée
          </p>
        ) : null}
        {proposal && list.current && (
          <section aria-label="Révision proposée" className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              Révision proposée : {proposal.added.length} ajouté{proposal.added.length > 1 ? "s" : ""},{" "}
              {proposal.removed.length} retiré{proposal.removed.length > 1 ? "s" : ""}, {proposal.changes.length} modifié
              {proposal.changes.length > 1 ? "s" : ""}
            </p>
            <ul className="list-disc space-y-1 pl-6 text-sm">
              {proposal.added.slice(0, 20).map((item) => <li key={`a-${item.id}`}>Ajouté : {item.label}</li>)}
              {proposal.removed.slice(0, 20).map((item) => <li key={`r-${item.id}`}>Retiré : {item.label}</li>)}
              {proposal.changes.slice(0, 20).map(({ previous, current }) => (
                <li key={`c-${current.id}`}>
                  Modifié : {previous.label === current.label ? current.label : `${previous.label} → ${current.label}`}
                </li>
              ))}
            </ul>
            {list.canWrite ? (
              <TakeoffItemListProposalForm
                projectId={projectId} expectedRevision={expectedRevision} digest={proposal.digest} cause="proposal"
                continuities={proposal.continuities.map((continuity) => ({ ...continuity,
                  previousLabel: byId.get(continuity.previousItemId)?.label ?? "Poste", nextLabel:
                    byId.get(continuity.nextItemId)?.label ?? "Poste" }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Un opérateur du métré de l’affaire peut l’accepter.</p>
            )}
          </section>
        )}
        {proposal && !list.current && list.canWrite && (
          <TakeoffItemListProposalForm projectId={projectId} expectedRevision={0} digest={proposal.digest} cause="initial"
            continuities={[]} />
        )}
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
                  <th scope="col" className="px-2 py-2">Référence quantitative</th>
                  <th scope="col" className="px-2 py-2">Origine</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(start, end).map((item) => (
                  <tr key={item.id} id={`poste-${item.id}`} className="border-b align-top">
                    <th scope="row" className="px-2 py-2 font-medium">{item.label}</th>
                    <td className="px-2 py-2">{sectionPath(item) || "—"}</td>
                    <td className="px-2 py-2">{item.expectedUnit ?? "À préciser"}</td>
                    <td className="px-2 py-2">
                      {item.referenceQuantity === null ? "—" : referenceFormat.format(item.referenceQuantity)}
                    </td>
                    <td className="px-2 py-2">{originText(item, list, sourceFormat)}</td>
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
                  {issue.title || sourceLocation(issue, sourceFormat)}{" · "}{ISSUE_LABELS[issue.reason]}
                </li>
              ))}
            </ul>
          </details>
        )}
        {pageCount > 1 && (
          <nav aria-label="Pagination de la liste des postes" className="flex flex-wrap items-center gap-4 text-sm">
            <span>Page {page} sur {pageCount}</span>
            {page > 1 && <Link href={pageHref(page - 1)} prefetch={false} className="underline">Page précédente</Link>}
            {page < pageCount && <Link href={pageHref(page + 1)} prefetch={false} className="underline">Page suivante</Link>}
          </nav>
        )}
        {list.canWrite && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ajouter un poste</summary>
            <div className="pt-3">
              <TakeoffItemListAddForm projectId={projectId} expectedRevision={expectedRevision} sections={sectionChoices} />
            </div>
          </details>
        )}
        {(list.history.length > 0 || list.continuities.length > 0) && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Historique de la liste</summary>
            <ul className="list-disc space-y-1 pl-6 pt-2 text-sm">
              {list.history.map((revision) => (
                <li key={revision.id}>
                  Révision {revision.revision} · {CAUSE_LABELS[revision.cause]} · {revision.item_count} postes · le{" "}
                  {dateFormat.format(new Date(revision.created_at))}
                  {list.names[revision.created_by] ? ` par ${list.names[revision.created_by]}` : ""}
                </li>
              ))}
              {list.continuities.map((continuity) => (
                <li key={continuity.source_key}>
                  Rapprochement confirmé en révision {continuity.accepted_in_revision} :{" "}
                  {byId.get(continuity.item_id)?.label ?? "poste retiré depuis"}
                  {list.names[continuity.accepted_by] ? ` par ${list.names[continuity.accepted_by]}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </JourneyPanel>
  );
}
