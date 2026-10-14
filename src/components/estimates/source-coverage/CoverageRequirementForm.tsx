"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { sourceReferenceDate } from "@/components/estimates/source-reference/source-reference-state";
import { coverageRequirementPayloadSchema, type CoverageCitation, type CoverageDimension, type CoverageDimensionMutation, type CoverageLink, type CoverageRequirement, type CoverageRequirementPayload, type CoverageTargetFact } from "@/lib/estimates/source-coverage-contracts";

import { CoverageDimensionDialog } from "./CoverageDimensionDialog";
import { CoverageFact } from "./CoverageFacts";
import { CoverageTargetPicker } from "./CoverageTargetPicker";
import { requirementPayload } from "./source-coverage-client";

export function CoverageRequirementForm({ versionId, value, activeCopyId, dimensions, disabled, onSave, onDimension, onDirty, onConsult, onChanged }: Readonly<{
  versionId: string; value: CoverageRequirement | null; activeCopyId: string | null; dimensions: CoverageDimension[]; disabled: boolean;
  onSave: (payload: CoverageRequirementPayload) => void;
  onDimension: (request: CoverageDimensionMutation) => void;
  onDirty: (dirty: boolean) => void;
  onConsult: (citation: CoverageCitation) => void;
  onChanged: () => void;
}>) {
  const [form, setForm] = useState(() => requirementPayload(value));
  const [error, setError] = useState<string | null>(null);
  const [showTargets, setShowTargets] = useState(false);
  const [showLots, setShowLots] = useState(false);
  const [lotLabel, setLotLabel] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [newFacts, setNewFacts] = useState<Record<string, CoverageTargetFact>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(requirementPayload(value));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  function change(next: CoverageRequirementPayload) {
    const technicalChanged = next.prescription !== form.prescription || next.expectedService !== form.expectedService ||
      JSON.stringify(next.scope) !== JSON.stringify(form.scope) || JSON.stringify(next.citations) !== JSON.stringify(form.citations) || JSON.stringify(next.links) !== JSON.stringify(form.links);
    setForm(technicalChanged ? { ...next, completeness: "partial", completenessReason: null } : next);
    setError(null); onChanged();
  }
  function linkTarget(fact: CoverageTargetFact | null) {
    if (!fact || !justification.trim()) { setError("Ajoutez une justification avant de lier cette cible."); return; }
    const id = crypto.randomUUID();
    const base = { id, justification: justification.trim() };
    const link: CoverageLink = fact.kind === "line" ? { ...base, kind: "line", itemId: fact.itemId }
      : fact.kind === "register" ? { ...base, kind: "register", registerEntryId: fact.registerEntryId }
      : { ...base, kind: "component", itemId: fact.itemId, applicationId: fact.applicationId, snapshotId: fact.snapshotId, componentId: fact.componentId };
    const identity = (entry: CoverageLink) => entry.kind === "line" ? `line:${entry.itemId}` : entry.kind === "register" ? `register:${entry.registerEntryId}` : `component:${entry.itemId}:${entry.applicationId}:${entry.snapshotId}:${entry.componentId}`;
    if (form.links.some((entry) => identity(entry) === identity(link))) { setError("Cette cible est déjà liée à l’exigence."); return; }
    if (form.links.length >= 100) { setError("Une exigence peut conserver au plus 100 liens."); return; }
    setNewFacts((previous) => ({ ...previous, [id]: fact }));
    change({ ...form, links: [...form.links, link] });
    setJustification("");
  }
  function save() {
    const payload = coverageRequirementPayloadSchema.safeParse({ ...form, prescription: form.prescription.trim(), expectedService: form.expectedService.trim(), completenessReason: form.completenessReason?.trim() || null,
      citations: form.citations.map((citation) => ({ ...citation, excerpt: citation.excerpt.trim(), folio: citation.folio?.trim() || null })), links: form.links.map((link) => ({ ...link, justification: link.justification.trim() })) });
    if (!payload.success) { setError(payload.error.issues[0]?.message ?? "Vérifiez les champs de l’exigence."); return; }
    onSave(payload.data);
  }
  return <div className="space-y-6">
    {error ? <Alert variant="danger">{error}</Alert> : null}
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">Prescription et périmètre</legend>
      <label className="block space-y-1 text-sm"><span>Prescription</span><Textarea value={form.prescription} maxLength={4000} onChange={(event) => change({ ...form, prescription: event.target.value })} /></label>
      <label className="block space-y-1 text-sm"><span>Prestation attendue</span><Textarea value={form.expectedService} maxLength={4000} onChange={(event) => change({ ...form, expectedService: event.target.value })} /></label>
      <label className="block space-y-1 text-sm"><span>Périmètre</span><NativeSelect value={form.scope.mode} onChange={(event) => {
        const mode = event.target.value as typeof form.scope.mode;
        change({ ...form, scope: { ...form.scope, mode, ...(mode === "specified" ? {} : { zoneId: null, networkId: null }) } });
      }}><option value="unspecified">Non précisé</option><option value="specified">Zones et réseaux précisés</option><option value="whole_project">Ensemble de l’affaire</option></NativeSelect></label>
      {form.scope.mode === "specified" ? <div className="grid gap-3 sm:grid-cols-2">{(["zone", "network"] as const).map((kind) => <label key={kind} className="space-y-1 text-sm"><span>{kind === "zone" ? "Zone" : "Réseau"}</span>
        <NativeSelect value={(kind === "zone" ? form.scope.zoneId : form.scope.networkId) ?? ""} onChange={(event) => change({ ...form, scope: { ...form.scope, [kind === "zone" ? "zoneId" : "networkId"]: event.target.value || null } })}>
          <option value="">Non précisé</option>{dimensions.filter((dimension) => dimension.kind === kind).map((dimension) => <option key={dimension.id} value={dimension.id} disabled={dimension.archived}>{dimension.label}{dimension.archived ? " (archivé)" : ""}</option>)}
        </NativeSelect></label>)}</div> : null}
      <CoverageDimensionDialog disabled={disabled} onSave={onDimension} />
      <div className="space-y-2"><p className="text-sm font-medium">Contexte du lot DPGF</p><p className="text-sm text-muted-foreground">{form.scope.dpgfLotId ? lotLabel ?? "Un lot DPGF est associé à cette exigence." : "Aucun lot DPGF associé."} Ce contexte est distinct de la zone et du réseau.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setShowLots(!showLots)}>Choisir un contexte DPGF</Button>{form.scope.dpgfLotId ? <Button type="button" variant="ghost" onClick={() => { change({ ...form, scope: { ...form.scope, dpgfLotId: null } }); setLotLabel(null); }}>Retirer le contexte DPGF</Button> : null}</div>
        {showLots ? <CoverageTargetPicker versionId={versionId} sectionOnly disabled={disabled} onPick={(option) => { change({ ...form, scope: { ...form.scope, dpgfLotId: option.id } }); setLotLabel(option.title); setShowLots(false); }} /> : null}
      </div>
    </fieldset>

    <section aria-label="Citations de l’exigence" className="space-y-3">
      <h3 className="font-semibold">Citations</h3>
      <p className="text-sm text-muted-foreground">Enregistrez les passages, puis consultez la copie conservée et confirmez chaque vérification. Le numéro de page physique commence à 1.</p>
      {form.citations.map((citation, index) => {
        const saved = value?.citations.find((entry) => entry.id === citation.id);
        return <section key={citation.id} aria-label={`Citation ${index + 1}`} data-testid={`coverage-citation-${citation.id}`} className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">{citation.copyId === activeCopyId ? "Référence actuelle" : "Ancienne référence : nouvelle vérification requise pour décider"}</p>
          <fieldset disabled={disabled} className="space-y-3"><legend className="sr-only">Passage cité</legend><div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Page physique</span><Input type="number" min={1} max={200} value={citation.page || ""} onChange={(event) => change({ ...form, citations: form.citations.map((entry) => entry.id === citation.id ? { ...entry, page: Number(event.target.value) } : entry) })} /></label>
            <label className="space-y-1 text-sm"><span>Folio imprimé</span><Input value={citation.folio ?? ""} maxLength={100} onChange={(event) => change({ ...form, citations: form.citations.map((entry) => entry.id === citation.id ? { ...entry, folio: event.target.value || null } : entry) })} /></label>
          </div><label className="block space-y-1 text-sm"><span>Passage cité</span><Textarea value={citation.excerpt} maxLength={4000} onChange={(event) => change({ ...form, citations: form.citations.map((entry) => entry.id === citation.id ? { ...entry, excerpt: event.target.value } : entry) })} /></label></fieldset>
          <p className="text-sm text-muted-foreground">{!dirty && saved?.verification ? `Passage vérifié humainement le ${sourceReferenceDate(saved.verification.occurredAt)}.` : "Passage à vérifier après enregistrement."}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={dirty || !saved?.canOpen} onClick={() => { if (saved) onConsult(saved); }}>Consulter le passage</Button>
            {!disabled && citation.copyId !== activeCopyId && activeCopyId ? <Button type="button" variant="outline" onClick={() => change({ ...form, citations: form.citations.map((entry) => entry.id === citation.id ? { id: crypto.randomUUID(), copyId: activeCopyId, page: 0, folio: null, excerpt: "" } : entry) })}>Remplacer par un passage de la référence actuelle</Button> : null}
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => change({ ...form, citations: form.citations.filter((entry) => entry.id !== citation.id) })}>Retirer la citation</Button></div>
        </section>;
      })}
      <Button type="button" variant="outline" disabled={disabled || !activeCopyId || form.citations.length >= 20} onClick={() => { if (activeCopyId) change({ ...form, citations: [...form.citations, { id: crypto.randomUUID(), copyId: activeCopyId, page: 1, folio: null, excerpt: "" }] }); }}>Ajouter une citation de la référence actuelle</Button>
    </section>

    <section aria-label="Liens de couverture" className="space-y-3">
      <h3 className="font-semibold">Liens de couverture</h3>
      <p className="text-sm text-muted-foreground">Plusieurs lignes ou entrées du registre peuvent traiter une exigence. Ces liens ne répartissent pas les quantités et n’ajoutent aucun coût au devis.</p>
      {form.links.map((link) => {
        const target = value?.targets.find((entry) => entry.linkId === link.id);
        const fact = newFacts[link.id] ?? target?.fact;
        return <div key={link.id} data-testid={`coverage-link-${link.id}`} className="space-y-2 rounded-lg border border-border p-3">
          {fact ? <CoverageFact fact={fact} /> : <p className="text-sm">{target?.reason ?? "La cible doit être relue après enregistrement."}</p>}
          {target && target.state !== "available" ? <p className="text-sm text-warning">{target.reason ?? "Cette cible ne peut pas justifier une nouvelle décision."}</p> : null}
          <label className="block space-y-1 text-sm"><span>Justification du lien enregistré</span><Textarea value={link.justification} maxLength={1000} disabled={disabled} onChange={(event) => change({ ...form, links: form.links.map((entry) => entry.id === link.id ? { ...entry, justification: event.target.value } : entry) })} /></label>
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => change({ ...form, links: form.links.filter((entry) => entry.id !== link.id) })}>Retirer le lien</Button>
        </div>;
      })}
      <Button type="button" variant="outline" disabled={disabled || form.links.length >= 100} onClick={() => setShowTargets(!showTargets)}>Ajouter un lien</Button>
      {showTargets ? <div className="space-y-3"><label className="block space-y-1 text-sm"><span>Justification du lien</span><Textarea value={justification} maxLength={1000} disabled={disabled} onChange={(event) => setJustification(event.target.value)} /></label>
        <CoverageTargetPicker versionId={versionId} disabled={disabled} onPick={(option) => linkTarget(option.fact)} />
      </div> : null}
    </section>

    <fieldset disabled={disabled} className="space-y-3 rounded-lg bg-muted/40 p-4"><legend className="sr-only">Complétude déclarée</legend>
      <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1" checked={form.completeness === "complete"} onChange={(event) => change({ ...form, completeness: event.target.checked ? "complete" : "partial", completenessReason: event.target.checked ? form.completenessReason : null })} /><span>Prestation entièrement traitée</span></label>
      <p className="text-sm text-muted-foreground">Cette déclaration humaine concerne uniquement cette exigence et ce périmètre. Ajouter un lien ne la valide pas automatiquement.</p>
      {form.completeness === "complete" ? <label className="block space-y-1 text-sm"><span>Motif de complétude</span><Textarea value={form.completenessReason ?? ""} maxLength={1000} onChange={(event) => change({ ...form, completenessReason: event.target.value || null })} /></label> : <p className="text-sm">Prestation partiellement traitée : les liens peuvent être conservés sans décision Chiffré ou Inclus ailleurs.</p>}
    </fieldset>
    <Button type="button" disabled={disabled || (!dirty && value !== null)} onClick={save}>Enregistrer les modifications</Button>
    {dirty ? <p className="text-sm text-warning" role="status">Modifications non enregistrées. L’aperçu et la vérification des citations attendent cet enregistrement.</p> : null}
  </div>;
}
