"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatItemQuantity } from "@/lib/takeoff/item-table-labels";
import { measureRefusals, type MeasureReview } from "@/lib/takeoff/measure-review-contracts";
import { sendMeasureRetention } from "@/lib/takeoff/item-table-client";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";

type Props = {
  projectId: string; jobId: string; label: string; planName: string;
  review: MeasureReview; undecided: boolean; acceptedMeasure: boolean; canReview: boolean; onRefresh: () => void; onRefused: (error: unknown) => boolean;
};

export function MeasureRetention({ projectId, jobId, label, planName, review, undecided, acceptedMeasure, canReview, onRefresh, onRefused }: Props) {
  const [intent, setIntent] = useState<string | null>(null);
  const [checks, setChecks] = useState({ gap_checked: false, rules_checked: false, proof_checked: false });
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expired = review.previously_retained && undecided;
  const requirements = [
    { key: "gap_checked", needed: review.gap_required, text: "J’ai vérifié l’écart à la DPGF." },
    { key: "rules_checked", needed: review.rules_required, text: "J’ai vérifié les justifications des contrôles en échec." },
    { key: "proof_checked", needed: review.proof_required, text: "J’ai vérifié la preuve de la mesure." },
  ] as const;
  const ready = !review.reason && requirements.every(({ key, needed }) => !needed || checks[key]);
  const actionable = canReview && (review.reason === null || review.reason === "justification_required");
  const location = (page: number | null) => page === null ? "" : ` · page ${page}`;
  const links = review.rows.filter(row => row.needs_justification && row.id).map(row => {
    const href = takeoffReviewHref({ projectId, jobId, targeted: true, line: row.id! });
    const params = new URLSearchParams({ reponse: review.answer_id, contribution: row.id! });
    return <Link key={row.id} className="block underline" href={href + "&" + params}>Justifier la contribution{location(row.page)}</Link>;
  });
  const amount = (value: number | null, unit = review.unit) => value === null ? "Aucune" : formatItemQuantity(value, unit);
  const facts = <div className="space-y-2">
    <p>Quantité observée · {amount(review.quantity)}</p>
    <p>Référence DPGF · {amount(review.reference, review.expected_unit)}</p>
    {review.gap !== null && <p>Écart à la DPGF · {amount(review.gap)}</p>}
    {review.proof_required && <p>Confiance inférieure au seuil de {Math.round(review.confidence_threshold * 100)} %.</p>}
    {review.rows.map(row => <div key={row.observation_id}>
      <p className="font-medium">Contribution{location(row.page)}</p>
      <p>Quantité de la contribution · {amount(row.quantity, row.unit)}</p>
      {row.evidence && <p>Preuve · {row.evidence}</p>}
      {row.confidence !== null && <p>Confiance · {Math.round(row.confidence * 100)} %</p>}
      {row.low_confidence && <p>La preuve de cette contribution doit être vérifiée.</p>}
      {row.failures.map((failure, index) => <p key={index}>Contrôle en échec · {failure}</p>)}
      {row.justification.length > 0 && <p>Justification de {row.author ?? "l’auteur"} · {row.justification.join(" · ")}</p>}
    </div>)}
  </div>;
  async function submit() {
    if (!intent || !ready || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await sendMeasureRetention(projectId, review.answer_id, { intent_key: intent, acknowledgement: { revision: review.revision, ...checks } });
      setIntent(null);
      onRefresh();
    } catch (caught) {
      if (onRefused(caught)) return;
      setError(isTakeoffApiError(caught) ? caught.message : "Impossible de retenir la mesure.");
      if (isTakeoffApiError(caught) && caught.status === 409) { setIntent(null); onRefresh(); }
    } finally { sending.current = false; setBusy(false); }
  }
  return <div className="space-y-2">
    {expired && <><p role="status">Les éléments sur lesquels vous aviez retenu cette mesure ont changé. Vérifiez la mesure à nouveau.</p>{facts}</>}
    {acceptedMeasure && review.retained && <p>Retenu sur ce plan · {amount(review.retained.quantity, review.retained.unit)}</p>}
    {review.reason && !(acceptedMeasure && review.reason === "already_decided") && <p>{measureRefusals[review.reason]}</p>}
    {canReview && review.reason === "justification_required" && links}
    {actionable && <Button variant="outline" size="sm" onClick={() => {
      setChecks({ gap_checked: false, rules_checked: false, proof_checked: false }); setError(""); setIntent(crypto.randomUUID());
    }}>Retenir cette mesure</Button>}
    {!intent && error && <p role="alert">{error}</p>}
    {intent && <Dialog open onOpenChange={open => { if (!open && !busy) setIntent(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Retenir cette mesure</DialogTitle><DialogDescription>{label} · {planName}</DialogDescription></DialogHeader>
        {facts}
        {review.reason && <p>{measureRefusals[review.reason]}</p>}
        {links}
        {requirements.filter(check => check.needed).map(({ key, text }) => <label key={key} className="flex items-start gap-2">
          <input type="checkbox" checked={checks[key]} disabled={busy} onChange={event => setChecks({ ...checks, [key]: event.target.checked })} />{text}
        </label>)}
        {error && <p role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setIntent(null)}>Annuler</Button>
          <Button disabled={!ready || busy} onClick={() => void submit()}>Retenir cette mesure</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
}
