import type { CoverageRequirement, CoverageTargetFact } from "@/lib/estimates/source-coverage-contracts";

export function CoverageFact({ fact }: { fact: CoverageTargetFact }) {
  if (fact.kind === "register") return <div className="space-y-1 text-sm"><p className="font-medium">{fact.text}</p>
    <p>{fact.entryKind === "assumption" ? "Hypothèse" : "Pièce manquante"} · {({ open: "Ouverte", validated: "Validée", rejected: "Rejetée", clarify_with_client: "À clarifier avec le client" })[fact.status]} · {fact.active ? "Active" : "Inactive"}</p>
    <p>Portée du registre : {({ project: "Affaire", lot: "Lot DPGF", line: "Ligne", exception: "Exception déclarée" })[fact.scopeType]}{fact.scopeLabel ? ` · ${fact.scopeLabel}` : ""}</p>
    {fact.scopeType === "exception" && fact.scopeRef ? <p>Référence de cette portée : {fact.scopeRef}. Son rapprochement avec l’exigence repose sur la justification du lien.</p> : null}
  </div>;
  return <div className="space-y-1 text-sm"><p className="font-medium">{fact.title}</p>
    <p>{fact.quantity === null ? "Quantité non précisée" : fact.quantity.toLocaleString("fr-FR")} {fact.unit ?? "Unité non précisée"}
      {fact.kind === "line" && fact.hours !== null ? ` · ${fact.hours.toLocaleString("fr-FR")} h` : ""}</p>
    {fact.kind === "component" ? <p className="text-muted-foreground">Composant appliqué dans {fact.parent.title} · parent : {fact.parent.quantity?.toLocaleString("fr-FR") ?? "quantité non précisée"} {fact.parent.unit ?? ""}</p> : null}
  </div>;
}

export function CoverageDecisionEvidence({ decision }: { decision: NonNullable<CoverageRequirement["lastDecision"]> }) {
  const facts = decision.facts;
  return <div className="space-y-3 text-sm">
    <p>Motif : {decision.reason}</p>
    {decision.otherLot ? <p>Lot destinataire : {decision.otherLot}</p> : null}
    {decision.uncertainty ? <p>Incertitude : {decision.uncertainty}</p> : null}
    <p>Prescription examinée : {facts.prescription}</p><p>Prestation examinée : {facts.expectedService}</p>
    <p>Périmètre examiné : {facts.scope.mode === "whole_project" ? "Ensemble de l’affaire" : facts.scope.mode === "unspecified" ? "Non précisé" : facts.dimensions.map((dimension) => dimension.label).join(" · ")}</p>
    {facts.dimensions.map((dimension) => dimension.extentNote ? <p key={dimension.id}>Étendue de {dimension.label} : {dimension.extentNote}</p> : null)}
    <p>Complétude déclarée : {facts.completeness === "complete" ? "Prestation entièrement traitée" : "Partielle"}{facts.completenessReason ? ` — ${facts.completenessReason}` : ""}</p>
    <p>Référence examinée : révision {decision.referenceRevision} · empreinte {decision.sha256.slice(0, 12)}…</p>
    {facts.citations.map((citation) => <blockquote key={citation.id} className="border-l-2 border-border pl-3">Page {citation.page}{citation.folio ? ` · folio ${citation.folio}` : ""} : {citation.excerpt}</blockquote>)}
    {facts.targets.map((target) => <div key={target.linkId} className="space-y-1 rounded-lg bg-muted/40 p-3">{target.fact ? <CoverageFact fact={target.fact} /> : <p>{target.reason ?? "Ancienne cible indisponible."}</p>}<p>Justification : {facts.links.find((link) => link.id === target.linkId)?.justification ?? "Non disponible dans cet événement"}</p></div>)}
  </div>;
}
