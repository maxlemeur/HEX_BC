"use client";

import { describeMarkCoverage } from "@/lib/takeoff/count-mark-schedule";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CHATGPT_REASONING_EFFORT_LABELS, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import { isTakeoffReadRefusal } from "@/components/takeoff/useTakeoffRequestActivity";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import type { ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import type { ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailLine } from "@/lib/takeoff/item-detail";
import { fetchItemMeasureReadings, previewItemRemeasure, sendItemRemeasure } from "@/lib/takeoff/item-table-client";
import { ITEM_REVIEW_COMMAND_VERSION, type ItemMeasureReadings, type ItemRemeasureCommand, type ItemRemeasurePreview } from "@/lib/takeoff/item-table-contracts";

type Props = { projectId: string; line: ItemDetailLine; plan: ItemDetailPlanView["plan"]; page: number; listRevisionId: string | null;
  receipt: ItemDetailAddress["receipt"]; onFollow: (receipt: NonNullable<ItemDetailAddress["receipt"]>) => void;
  onOpenComparison: (jobId: string, page: number) => void; onRefresh: () => void; onOpenCurrent: () => void; onRefused: (error: unknown) => boolean };
type Summary = { preview: ItemRemeasurePreview; command: Omit<ItemRemeasureCommand, "setting"> };
const effects = { first: "Cette mesure donnera une première réponse au poste sur ce plan.",
  compare: "La lecture précédente est indivisible. Vous pourrez comparer les deux lectures. Pour la remplacer, mesurez tout le plan.",
  replace: "La nouvelle lecture remplacera la lecture précédente sur cette portée." };
const states = { queued: "En attente de lecture", running: "Lecture en cours", succeeded: "Lecture terminée", failed: "Lecture échouée",
  canceled: "Lecture arrêtée", not_started: "Lecture non démarrée" };
const failure = (error: unknown) => isTakeoffApiError(error) ? error.message : "La mesure du poste est momentanément indisponible.";

function Reading({ title, reading }: { title: string; reading: NonNullable<ItemMeasureReadings>["latest"] }) {
  if (!reading) return <p>{title} · Aucune réponse</p>;
  const value = reading.outcome === "measured" ? `${reading.quantity?.toLocaleString("fr-FR")} ${reading.unit ?? ""}`
    : reading.outcome === "not_found" ? "Non trouvé" : "Incertain";
  return <div className="min-w-0 space-y-1">
    <p>{title} · {value}{reading.pages.length > 0 ? ` · pages ${reading.pages.join(", ")}` : ""}</p>
    {reading.unreadablePages.length > 0 && <p>Pages illisibles · {reading.unreadablePages.join(", ")}</p>}
    {reading.coverage?.map((sheet) => <p key={sheet.page}>{describeMarkCoverage(sheet)}</p>)}
    {reading.reasons.map((reason, index) => <p key={index}>{reason}</p>)}
    {reading.observations.length > 0 && <details><summary>Observations ({reading.observations.length})</summary>
      <ul>{reading.observations.map((o) => <li key={o.id}>Page {o.page} · {o.evidence || "Preuve absente"}</li>)}</ul>
    </details>}
  </div>;
}

export function MeasureItemOnPlan({ projectId, line, plan, page, listRevisionId, receipt, onFollow, onRefresh, onOpenCurrent, onOpenComparison, onRefused }: Props) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ChatGptReasoningEffort | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposeMarks, setProposeMarks] = useState(false);
  const [singlePage, setSinglePage] = useState(false);
  const [readings, setReadings] = useState<ItemMeasureReadings>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [watch, setWatch] = useState(0);
  const [changedCopy, setChangedCopy] = useState(false);
  const [needsPreview, setNeedsPreview] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const operation = useRef(0);
  const submitting = useRef(false);
  const readGeneration = useRef(0);
  const refreshWhenDone = useRef<string | null>(null);
  const follow = useEffectEvent(onFollow);
  const requestId = receipt?.requestId;
  const jobId = receipt?.jobId;
  const refreshed = useEffectEvent(onRefresh);
  useEffect(() => () => { operation.current++; }, []);
  useEffect(() => {
    let live = true;
    const generation = readGeneration.current;
    const followed = requestId && jobId ? { requestId, jobId } : undefined;
    setReadings(null);
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await fetchItemMeasureReadings(projectId, line.itemId, plan.key, followed);
        if (!live || generation !== readGeneration.current) return;
        setReadFailed(false);
        setReadings(result);
        if (!result) return;
        const pending = result.state === "queued" || result.state === "running";
        if (pending) refreshWhenDone.current = result.jobId;
        if (!followed) {
          follow({ requestId: result.requestId, jobId: result.jobId });
        } else if (pending) {
          timer = setTimeout(read, 2500);
        } else if (refreshWhenDone.current === result.jobId) {
          refreshWhenDone.current = null;
          refreshed();
        }
      } catch (error) {
        if (!live || generation !== readGeneration.current) return;
        if (isTakeoffReadRefusal(error) && onRefused(error)) return;
        setReadFailed(true);
        setMessage(failure(error));
      }
    }
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, line.itemId, plan.key, requestId, jobId, watch, onRefused]);

  async function show(onlyPage: boolean, keepSetting = false, marks = keepSetting && proposeMarks) {
    if (submitting.current || !plan.planFileId) return;
    const id = ++operation.current;
    setSinglePage(onlyPage);
    setProposeMarks(marks);
    setOpen(true);
    setSummary(null);
    setMessage("");
    setNeedsPreview(false);
    setChangedCopy(false);
    setUnsure(false);
    const scope = { kind: "plan" as const, planKey: plan.key };
    const detail = { ...(marks && { proposeMarks: true as const }), fileId: plan.planFileId, generation: plan.generation, contentSha256: plan.contentSha256, page: onlyPage ? page : null };
    const prior = line.readings.find((r) => r.planKey === plan.key)?.answer;
    const seen = { list_revision_id: listRevisionId, targets: [{ ...line.targets, answers: line.targets.answers.filter((a) => a.answerId === prior?.answerId) }] };
    try {
      const preview = await previewItemRemeasure(projectId, scope, [line.itemId], seen, detail);
      if (operation.current !== id) return;
      if (!keepSetting || !model) {
        setModel(preview.subscription.state === "ready" ? preview.subscription.model : "");
        setEffort(preview.subscription.state === "ready" ? preview.subscription.reasoningEffort : null);
      }
      setSummary({ preview, command: { command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: crypto.randomUUID(),
        scope, detail, ...(preview.detail?.markSchedule && { mark_schedule: preview.detail.markSchedule }), host_proof: preview.detail?.hostProof ?? undefined, item_ids: [line.itemId], plan_keys: [plan.key], seen, preview_digest: preview.previewDigest } });
    } catch (error) {
      if (isTakeoffReadRefusal(error) && onRefused(error)) return;
      if (operation.current === id) {
        setMessage(failure(error));
        setChangedCopy(isTakeoffApiError(error) && error.code === "TAKEOFF_ITEM_MEASURE_COPY_CHANGED");
        setNeedsPreview(true);
        onRefresh();
      }
    }
  }
  async function confirm() {
    if (!summary || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const id = operation.current;
    try {
      const result = await sendItemRemeasure(projectId, { ...summary.command, setting: { model, reasoning_effort: effort } });
      if (id !== operation.current) return;
      setUnsure(false);
      if (result.outcome === "already_running") {
        setMessage("Une demande de métré est déjà active sur cette affaire. Votre sélection est conservée.");
        setNeedsPreview(true);
      } else {
        if (result.receipt && result.requestId) {
          readGeneration.current++;
          refreshWhenDone.current = result.receipt.jobId;
          onFollow({ requestId: result.requestId, jobId: result.receipt.jobId });
        }
        setReadings(null);
        setOpen(false);
        setMessage(`Demande enregistrée sur votre forfait. Reçu ${result.requestId}.`);
        if (result.receipt?.jobId === jobId) setWatch((n) => n + 1);
      }
    } catch (error) {
      if ((isTakeoffReadRefusal(error) && onRefused(error)) || id !== operation.current) return;
      setMessage(failure(error));
      const lost = !isTakeoffApiError(error) || !error.status || error.status === 200 || error.status >= 500;
      setChangedCopy(isTakeoffApiError(error) && error.code === "TAKEOFF_ITEM_MEASURE_COPY_CHANGED");
      setUnsure(lost);
      setNeedsPreview(!lost);
      if (!lost) onRefresh();
    } finally {
      submitting.current = false;
      if (id === operation.current) setBusy(false);
    }
  }
  const preview = summary?.preview;
  const selected = preview?.models?.find((m) => m.id === model);
  return <section className="shrink-0 space-y-1 border-t border-border px-3 py-2 text-xs">
    <Button size="xs" variant="outline" onClick={() => void show(false)}>
      {readings?.latest?.comparisonOnly ? "Mesurer tout le plan" : "Mesurer ce poste"}
    </Button>
    {readFailed && <Button size="xs" variant="outline" onClick={() => setWatch((n) => n + 1)}>Actualiser le résultat</Button>}
    {message && !open ? <p role="status">{message}</p> : null}
    {readings ? <div aria-live="polite" data-testid="poste-mesure-resultat">
      <p>{states[readings.state]} {readings.reason}</p>
      <p>Reçu de la demande · {readings.requestId}</p>
      {readings.latest ? <><div className="grid gap-2 sm:grid-cols-2">
        <Reading title={readings.previous && line.readings.some((r) => r.answer?.answerId === readings.previous!.answerId) ? "Lecture précédente · actuelle" : "Lecture précédente"} reading={readings.previous} /><Reading title="Nouvelle lecture" reading={readings.latest} /></div>
        {readings.latest.comparisonOnly && <div>
          <p>La nouvelle lecture est une comparaison en lecture seule. Vos corrections restent sur la lecture actuelle.</p>
          {readings.latest.coverage?.length ? <>
            <Button size="xs" variant="outline" onClick={() => onOpenComparison(readings.latest!.jobId, readings.latest!.coverage![0].page)}>
              Voir les propositions de la comparaison
            </Button>
            <Button size="xs" variant="outline" onClick={() => void show(false, false, true)}>Mesurer tout le plan</Button>
          </> : <p>Mesurez tout le plan pour remplacer la lecture actuelle.</p>}
        </div>}</> : null}
    </div> : null}
    <Dialog open={open} onOpenChange={(value) => { if (!value && !submitting.current && !unsure) { operation.current++; setOpen(false); } }}>
      <DialogContent><DialogHeader><DialogTitle>Mesurer ce poste</DialogTitle>
        <DialogDescription>{line.label} · {line.expectedUnit ?? "Unité non renseignée"} · {plan.name}</DialogDescription></DialogHeader>
        <label>Portée <select value={singlePage ? "page" : "plan"} disabled={busy || unsure} onChange={(e) => void show(e.target.value === "page", true)}>
          <option value="plan">Toutes les pages admises du plan</option><option value="page">Page affichée seule · {page}</option>
        </select></label>
        <label><input type="checkbox" checked={proposeMarks} disabled={busy || unsure}
          onChange={(e) => void show(singlePage, true, e.target.checked)} /> Proposer des repères à vérifier</label>
        {proposeMarks && preview?.detail?.markSchedule && <p>
          {preview.detail.markSchedule.tile_calls} appels de repérage en série et {preview.detail.markSchedule.other_calls} autres appels,
          soit {preview.detail.markSchedule.total_calls} appels au maximum. Lecteurs non qualifiés.
        </p>}
        {proposeMarks && preview?.detail?.effect === "compare" && <p>
          Ces propositions seront en lecture seule et ne pourront pas être adoptées. Pour les vérifier, mesurez tout le plan.
          <Button size="xs" variant="outline" disabled={busy || unsure} onClick={() => void show(false,true)}>Mesurer tout le plan</Button>
        </p>}
        {preview ? <>
          <p>Indice du document · {preview.detail?.revision ?? "Non renseigné"}</p>
          {preview.detail ? <><p>Pages admises · {preview.detail.pages.length ? preview.detail.pages.join(", ") : `Tout le plan (${preview.detail.pageCount ?? "nombre inconnu"} pages)`}</p>
            <p>Couverture précédente · {preview.detail.previousPages.join(", ") || "Aucune page connue"}</p>
            <p>{effects[preview.detail.effect]}</p></> : null}
          <p>Niveau · Détaillé</p><p>Forfait de {preview.payer.name ?? "la personne connectée"}</p>
          {preview.subscription.state === "unavailable" ? <p role="alert">{preview.subscription.reason}</p> : <>
            <label>Modèle <select value={model} disabled={busy || unsure} onChange={(e) => { setModel(e.target.value); setEffort(null); }}>
              {!selected ? <option value={model}>{model} (indisponible)</option> : null}
              {preview.models?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Niveau de raisonnement <select value={effort ?? ""} disabled={busy || unsure}
              onChange={(e) => setEffort(e.target.value as ChatGptReasoningEffort || null)}>
              <option value="">Automatique</option>{selected?.reasoningEfforts.map((f) => <option key={f} value={f}>{CHATGPT_REASONING_EFFORT_LABELS[f]}</option>)}
            </select></label></>}
          {preview.reading.state === "ready" ? <p>{preview.detail?.markSchedule && "Hors repérage · "}{preview.reading.summary} Budget réservé · {preview.reading.budgetTokens.toLocaleString("fr-FR")} jetons.</p>
            : <p role="alert">{preview.reading.reason}</p>}
          {preview.running ? <p>Une demande de métré est déjà active sur cette affaire. Votre sélection est conservée.</p> : null}
        </> : !message ? <p role="status">Préparation du récapitulatif…</p> : null}
        {message ? <p role="alert">{message}</p> : null}
        <DialogFooter><Button variant="outline" disabled={busy || unsure} onClick={() => { operation.current++; setOpen(false); }}>Fermer</Button>
          {changedCopy ? <Button onClick={onOpenCurrent}>Ouvrir la copie actuelle du plan</Button>
            : needsPreview || preview?.running ? <Button disabled={busy} onClick={() => void show(singlePage, true)}>Relire le récapitulatif</Button>
            : <Button disabled={!preview?.detail || !selected || (effort !== null && !selected.reasoningEfforts.includes(effort)) || preview.reading.state !== "ready" || busy}
              onClick={() => void confirm()}>{unsure ? "Retrouver le reçu" : "Mesurer avec mon forfait"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
