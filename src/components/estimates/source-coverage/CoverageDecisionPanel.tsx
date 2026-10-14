"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { sourceReferenceDate } from "@/components/estimates/source-reference/source-reference-state";
import { coverageDecisionInputSchema, type CoverageDecisionMutation, type CoveragePreview, type CoverageRequirement } from "@/lib/estimates/source-coverage-contracts";

import { CoverageDecisionEvidence, CoverageFact } from "./CoverageFacts";
import { treatmentLabels, validityLabels } from "./source-coverage-client";

export function CoverageDecisionPanel({ requirement, preview, disabled, dirty, unavailable, onPreview, onDecide }: Readonly<{
  requirement: CoverageRequirement; preview: CoveragePreview | null; disabled: boolean; dirty: boolean; unavailable: boolean;
  onPreview: () => void; onDecide: (request: CoverageDecisionMutation) => void;
}>) {
  const [treatment, setTreatment] = useState(requirement.treatment);
  const [reason, setReason] = useState("");
  const [otherLot, setOtherLot] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blockingReasons = preview ? [...new Set([...preview.blockingReasons, ...preview.treatmentBlockingReasons[treatment]])] : [];
  const last = requirement.lastDecision;
  function decide() {
    if (!preview || acknowledged !== preview.reviewedFingerprint) return;
    const decision = coverageDecisionInputSchema.safeParse({ treatment, reason: reason.trim(), otherLot: otherLot.trim() || null, uncertainty: uncertainty.trim() || null, completeness: requirement.completeness });
    if (!decision.success) { setError(decision.error.issues[0]?.message ?? "Vérifiez la décision."); return; }
    if (treatment === "other_lot" && !decision.data.otherLot) { setError("Nommez le lot destinataire."); return; }
    if (treatment === "provisional" && !decision.data.uncertainty) { setError("Décrivez l’incertitude restante."); return; }
    setError(null);
    onDecide({ requirementId: requirement.id, expectedRequirementRevision: preview.requirementRevision, expectedReferenceRevision: preview.referenceRevision,
      expectedContentRevision: preview.contentRevision, reviewedFingerprint: preview.reviewedFingerprint, operationKey: crypto.randomUUID(), decision: decision.data });
  }
  return <section aria-label="Décision de couverture" className="space-y-4 border-t border-border pt-6">
    <h3 className="font-semibold">Décider du traitement</h3>
    <p className="text-sm">Traitement enregistré : <strong>{treatmentLabels[requirement.treatment]}</strong> · {unavailable ? "validité à la dernière lecture" : "validité"} : <strong>{validityLabels[requirement.validity]}</strong></p>
    {requirement.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-warning">{requirement.reasons.map((value, index) => <li key={index}>{value}</li>)}</ul> : null}
    {last ? <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Faits de la dernière décision — {sourceReferenceDate(last.occurredAt)}</summary>
      <div className="mt-3"><CoverageDecisionEvidence decision={last} /></div></details> : null}
    <fieldset disabled={disabled || dirty} className="space-y-3"><legend className="sr-only">Nouveau traitement</legend>
      <label className="block space-y-1 text-sm"><span>Traitement</span><NativeSelect value={treatment} onChange={(event) => { setTreatment(event.target.value as typeof treatment); setAcknowledged(null); }}>{Object.entries(treatmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label>
      <label className="block space-y-1 text-sm"><span>Motif de décision</span><Textarea value={reason} maxLength={1000} onChange={(event) => { setReason(event.target.value); setAcknowledged(null); }} /></label>
      {treatment === "other_lot" ? <label className="block space-y-1 text-sm"><span>Lot destinataire</span><Input value={otherLot} maxLength={200} onChange={(event) => { setOtherLot(event.target.value); setAcknowledged(null); }} /></label> : null}
      {treatment === "provisional" ? <label className="block space-y-1 text-sm"><span>Incertitude restante</span><Textarea value={uncertainty} maxLength={1000} onChange={(event) => { setUncertainty(event.target.value); setAcknowledged(null); }} /></label> : null}
    </fieldset>
    <Button type="button" variant="outline" disabled={disabled || dirty} onClick={() => { setAcknowledged(null); setError(null); onPreview(); }}>Préparer la décision</Button>
    {preview ? <section aria-label="Aperçu de la décision" className="space-y-3 rounded-lg border border-border p-4">
      <h4 className="font-semibold">Faits à examiner</h4>
      <p className="text-sm">{preview.facts.prescription}</p><p className="text-sm">{preview.facts.expectedService}</p>
      {preview.facts.citations.map((citation) => <blockquote key={citation.id} className="border-l-2 border-border pl-3 text-sm">Page {citation.page}{citation.folio ? ` · folio ${citation.folio}` : ""} : {citation.excerpt}</blockquote>)}
      {preview.facts.targets.map((target) => <div key={target.linkId}>{target.fact ? <CoverageFact fact={target.fact} /> : <p className="text-sm text-warning">{target.reason ?? "Cible indisponible"}</p>}</div>)}
      {blockingReasons.length ? <Alert variant="warning"><ul className="list-disc pl-5">{blockingReasons.map((value, index) => <li key={index}>{value}</li>)}</ul></Alert> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={disabled || dirty} checked={acknowledged === preview.reviewedFingerprint} onChange={(event) => setAcknowledged(event.target.checked ? preview.reviewedFingerprint : null)} /><span>J’ai examiné les faits et le traitement proposé</span></label>
    </section> : null}
    {error ? <Alert variant="danger">{error}</Alert> : null}
    <Button type="button" disabled={disabled || dirty || !reason.trim() || !preview || acknowledged !== preview.reviewedFingerprint || blockingReasons.length > 0} onClick={decide}>Confirmer le traitement</Button>
    <p className="text-sm text-muted-foreground">La décision décrit les éléments examinés. Elle ne certifie pas l’exhaustivité du CCTP et ne modifie aucun montant du devis.</p>
  </section>;
}
