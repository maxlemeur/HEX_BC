"use client";

import { useId, useRef, useState } from "react";
import { FileIcon, InfoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  AffaireIntakeBriefBlockKey,
  AffaireIntakeBriefDraft,
  AffaireIntakeBriefSource,
} from "@/lib/affaires/intake";

export const BRIEF_REVIEW_LABELS: Record<AffaireIntakeBriefBlockKey, string> = {
  summary: "Synthèse",
  project_object: "Objet du projet",
  scope: "Périmètre",
  lots: "Lots concernés",
  received_pieces: "Pièces reçues",
  assumptions: "Hypothèses initiales",
  vigilance_points: "Points de vigilance",
  missing_elements: "Éléments manquants",
};

function buildBriefSourceHref(projectId: string, source: AffaireIntakeBriefSource) {
  const params = new URLSearchParams({
    intakeDocument: source.sourceDocumentId,
    briefBlock: source.blockKey,
    briefEntry: String(source.entryIndex),
  });
  return `/dashboard/affaires/${projectId}?${params.toString()}#intake`;
}

export function BriefSourceAnnotation({ projectId, sources }: {
  projectId: string;
  sources: AffaireIntakeBriefSource[];
}) {
  if (sources.length === 0) {
    return <span className="brief-proof-label">Sans preuve directe</span>;
  }
  const uniqueSources = Array.from(new Map(sources.map((source) => [
    `${source.sourceDocumentId}:${source.sourceFileName}`, source,
  ])).values());
  return (
    <div className="brief-source-links">
      {uniqueSources.map((source) => (
        <a key={`${source.sourceDocumentId}:${source.sourceFileName}`} href={buildBriefSourceHref(projectId, source)}
          title={`Ouvrir ${source.sourceFileName} dans le dossier ; passage non vérifié`}>
          <FileIcon size={15} aria-hidden="true" />
          <span>Document associé · {source.sourceFileName}</span>
        </a>
      ))}
      <small>Passage non vérifié</small>
    </div>
  );
}

type ReviewKey = "summary" | "scope" | "object_lots" | "assumptions" | "vigilance_points" | "missing_elements";
type ReviewEntry = {
  text: string;
  blockKey: AffaireIntakeBriefBlockKey;
  index: number;
  empty?: boolean;
};
type ReviewGroup = { key: ReviewKey; label: string; entries: ReviewEntry[] };

export function BriefReviewPanel({
  projectId, briefDraft, sourceLookup, hasPlans, onResolvePlanGap, onOpenDocuments,
}: {
  projectId: string;
  briefDraft: AffaireIntakeBriefDraft;
  sourceLookup: Map<string, AffaireIntakeBriefSource[]>;
  hasPlans: boolean;
  onResolvePlanGap?: (index: number) => void;
  onOpenDocuments?: () => void;
}) {
  const [selected, setSelected] = useState<ReviewKey>("scope");
  const inspectorId = useId();
  const inspectorRef = useRef<HTMLElement>(null);
  const listEntries = (blockKey: AffaireIntakeBriefBlockKey, items: string[]) =>
    items.map((text, index) => ({ text, blockKey, index }));
  const groups: ReviewGroup[] = [
    { key: "summary", label: "Synthèse du dossier", entries: [{ text: briefDraft.summary, blockKey: "summary", index: 0 }] },
    { key: "scope", label: "Périmètre", entries: listEntries("scope", briefDraft.scope) },
    { key: "object_lots", label: "Objet et lots", entries: [
      { text: briefDraft.projectObject, blockKey: "project_object", index: 0 },
      ...(briefDraft.lots.length > 0 ? listEntries("lots", briefDraft.lots) : [
        { text: "Aucun lot détecté — à préciser.", blockKey: "lots" as const, index: 0, empty: true },
      ]),
    ] },
    { key: "assumptions", label: "Hypothèses initiales", entries: listEntries("assumptions", briefDraft.assumptions) },
    { key: "vigilance_points", label: "Points de vigilance", entries: listEntries("vigilance_points", briefDraft.vigilancePoints) },
    { key: "missing_elements", label: "Réserves à qualifier", entries: listEntries("missing_elements", briefDraft.missingElements) },
  ];
  const selectedGroup = groups.find((group) => group.key === selected)!;
  const sourcesFor = (entry: ReviewEntry) => entry.empty ? [] : sourceLookup.get(`${entry.blockKey}:${entry.index}`) ?? [];
  const sourcedEntries = selectedGroup.entries.filter((entry) => sourcesFor(entry).length > 0);
  const inspect = (key: ReviewKey) => {
    setSelected(key);
    requestAnimationFrame(() => {
      const inspector = inspectorRef.current;
      if (!inspector) return;
      inspector.focus({ preventScroll: true });
      const heading = inspector.querySelector("h3")?.getBoundingClientRect();
      const topInset = Number.parseFloat(window.getComputedStyle(inspector).scrollMarginTop) || 0;
      if (heading && (heading.top < topInset || heading.bottom > window.innerHeight)) {
        inspector.scrollIntoView({ block: "start" });
      }
    });
  };

  const renderGroup = (group: ReviewGroup) => {
    const entries = group.entries.length > 0 ? group.entries : [{
      text: group.key === "vigilance_points" ? "Aucun point détecté — à relire."
        : group.key === "missing_elements" ? "Aucun manque signalé dans le brief."
          : "Aucun élément détecté — à préciser.",
      blockKey: group.key === "object_lots" ? "project_object" : group.key,
      index: 0, empty: true,
    } satisfies ReviewEntry];
    return (
      <tbody key={group.key}>
        {entries.map((entry, index) => {
          const sources = sourcesFor(entry);
          const planGap = entry.blockKey === "missing_elements" && entry.text === "Plans manquants";
          const resolved = Boolean(planGap && hasPlans && briefDraft.resolvedPlanGapIndexes?.includes(entry.index));
          return (
            <tr key={`${entry.blockKey}:${entry.index}`} className={`${selected === group.key ? "is-selected " : ""}${index === 0 ? "brief-group-start " : ""}${index === entries.length - 1 ? "brief-group-end" : ""}`}>
              <td>
                {index === 0 && group.key !== "missing_elements" ? (
                  <h3><button type="button" aria-label={`Examiner les preuves : ${group.label}`}
                    aria-pressed={selected === group.key} aria-controls={inspectorId} onClick={() => inspect(group.key)}>
                    {group.label}{group.key === "assumptions" && briefDraft.assumptions.length > 0 ? ` (${briefDraft.assumptions.length})` : ""}
                  </button></h3>
                ) : null}
                <p className={entry.empty ? "brief-empty-text" : undefined}>{entry.text}{resolved ? " · mention historique, plans reçus" : ""}</p>
                {resolved ? <span className="brief-resolved-label">Traité</span> : null}
                {planGap && hasPlans && !resolved && onResolvePlanGap ? (
                  <button type="button" className="brief-text-action" onClick={() => onResolvePlanGap(entry.index)}>
                    Marquer les plans comme reçus
                  </button>
                ) : null}
              </td>
              <td>
                {entry.empty ? <span className="brief-empty-text">{group.key === "missing_elements" ? "Aucun signalement" : "Non renseigné"}</span> : (
                  <>
                    <span className={`brief-proof-label${sources.length > 0 ? " has-document" : ""}`}>{sources.length > 0 ? "Document associé" : "Sans preuve directe"}</span>
                    {sources.length > 0 ? <small className="brief-proof-note">Passage non vérifié</small> : null}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    );
  };

  return (
    <div className="brief-review-columns">
      <div className="brief-review-information">
        <table className="brief-information-table" aria-label="Informations du brief">
          <colgroup><col /><col className="brief-proof-column" /></colgroup>
          <thead><tr><th scope="col">Information</th><th scope="col">État de preuve</th></tr></thead>
          {groups.filter((group) => group.key !== "missing_elements").map(renderGroup)}
        </table>
        <div className="brief-reserves-heading"><h3><button type="button" aria-label="Examiner les preuves : Réserves à qualifier"
          aria-pressed={selected === "missing_elements"} aria-controls={inspectorId} onClick={() => inspect("missing_elements")}>Réserves à qualifier</button></h3></div>
        <table className="brief-information-table brief-reserves-table" aria-label="Réserves du brief">
          <colgroup><col /><col className="brief-proof-column" /></colgroup>
          <thead className="sr-only"><tr><th scope="col">Réserve</th><th scope="col">État de preuve</th></tr></thead>
          {renderGroup(groups[groups.length - 1])}
        </table>
      </div>
      <aside id={inspectorId} ref={inspectorRef} tabIndex={-1} aria-label="Preuves du brief" className="brief-proof-inspector">
        <h3>{selectedGroup.label}</h3>
        {sourcedEntries.length === 0 ? (
          <>
            <p className="brief-proof-notice"><InfoIcon size={19} aria-hidden="true" /><strong>Aucune preuve directe associée</strong></p>
            <p className="brief-inspector-description">{selectedGroup.entries.length === 0
              ? "Aucun élément détecté pour cette rubrique."
              : "Aucun document n’est lié à cette information."}</p>
          </>
        ) : (
          <>
            <p className="brief-inspector-description">Les documents ci-dessous sont associés aux informations indiquées. Leurs passages ne sont pas vérifiés.</p>
            {sourcedEntries.map((entry) => (
              <div key={`${entry.blockKey}:${entry.index}`} role="group" aria-label={entry.text} className="brief-inspector-entry">
                <p>{entry.text}</p>
                <BriefSourceAnnotation projectId={projectId} sources={sourcesFor(entry)} />
              </div>
            ))}
          </>
        )}
        <div className="brief-received-inventory">
          <h3>Pièces reçues · inventaire</h3>
          {briefDraft.receivedPieces.length > 0 ? <ul>
            {briefDraft.receivedPieces.map((piece, index) => <li key={index}><FileIcon size={21} className={piece.toLowerCase().endsWith(".pdf") ? "brief-file-pdf" : undefined} aria-hidden="true" /><span>{piece}</span></li>)}
          </ul> : <p className="brief-empty-text">Aucune pièce répertoriée dans le brief.</p>}
          {onOpenDocuments ? <Button onClick={onOpenDocuments}><FileIcon size={16} aria-hidden="true" />Consulter les pièces</Button>
            : <a className="brief-text-action" href={`/dashboard/affaires/${projectId}#intake`}>Consulter les pièces</a>}
        </div>
      </aside>
    </div>
  );
}
