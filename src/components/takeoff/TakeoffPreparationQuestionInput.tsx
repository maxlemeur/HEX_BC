"use client";

import { useId, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";

export function TakeoffPreparationQuestionInput({ draft, onChange }: {
  draft: TakeoffPreparation;
  onChange: (draft: TakeoffPreparation) => void;
}) {
  const id = useId();
  const [question, setQuestion] = useState("");
  const [impact, setImpact] = useState<"blocking" | "reservation">("reservation");
  const [sourceId, setSourceId] = useState("");
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">Ajouter un point à préciser</summary>
    <div className="mt-3 space-y-3">
      <label htmlFor={`${id}-question`} className="block space-y-1 text-sm"><span>Nouveau point à préciser</span><Input id={`${id}-question`} value={question} maxLength={4000} onChange={(event) => setQuestion(event.target.value)} /></label>
      <label htmlFor={`${id}-impact`} className="block space-y-1 text-sm"><span>Impact du point</span><NativeSelect id={`${id}-impact`} value={impact} onChange={(event) => setImpact(event.target.value as typeof impact)}><option value="reservation">Réserve admissible après décision</option><option value="blocking">Réponse indispensable</option></NativeSelect></label>
      <label htmlFor={`${id}-source`} className="block space-y-1 text-sm"><span>Pièce concernée</span><NativeSelect id={`${id}-source`} value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Contexte général</option>{draft.sources.map((source) => <option key={source.document_id} value={source.document_id}>{source.document_name}</option>)}</NativeSelect></label>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!question.trim()} onClick={() => {
        onChange({ ...draft, unknowns: [...draft.unknowns, { id: `manual:${crypto.randomUUID()}`, question: question.trim(), impact, status: "open", answer: null, responsible: null, source_document_id: sourceId || null, page: null }] });
        setQuestion("");
      }}>Ajouter la question</button>
    </div>
  </details>;
}
