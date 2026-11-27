"use client";

import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { EntryScopeCommand, EntryScopeResult } from "@/lib/takeoff/entry-scope-contracts";
import { entryReadingReason } from "@/lib/takeoff/item-entry-choice";
import { fetchItemLine, sendEntryScope } from "@/lib/takeoff/item-table-client";
import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import { formatEntryQuantity } from "@/lib/takeoff/item-table-labels";
import { QUANTITY_ENTRY_CATEGORIES } from "@/lib/takeoff/quantity-entry";
import { PARIS_DATE_TIME_FORMAT as date } from "@/lib/format/fr";

const titles = { attach: "Rattacher cette saisie à un plan", withdraw: "Retirer la saisie de l’affaire" };
const messages = {
  stale: "La saisie a changé depuis votre lecture. Fermez et vérifiez les valeurs avant de recommencer.",
  sent: "Une part de ce poste est déjà au devis. La saisie reste en place.",
  ineligible: "Ce plan ne peut plus recevoir la saisie. Vérifiez sa présence dans l’affaire et la lecture du poste.",
};
type Entry = NonNullable<ItemTableResponseLine["entry"]>;
type Snapshot = { action: keyof typeof titles; source: Entry; plans: Array<{ key: string; name: string; revision: number; unavailable: string | null }> };

export function EntryScopeActions({ projectId, viewerKey, line, filtered, version, onRefused, onRefresh }: {
  projectId: string; viewerKey: string; line: ItemTableResponseLine; filtered: boolean; version: number;
  onRefused: (error: unknown) => boolean; onRefresh: (uncertain?: boolean) => void;
}) {
  const needsFullLine = filtered && line.entry?.scope !== "affaire";
  const read = useSWR(needsFullLine && line.wholeEntry ? ["poste-entry-scope", viewerKey, projectId, line.itemId, version] : null,
    () => fetchItemLine(projectId, line.itemId), { shouldRetryOnError: false });
  useEffect(() => { if (read.error) onRefused(read.error); }, [read.error, onRefused]);
  const full = needsFullLine ? read.data?.canReview && !read.error ? read.data.line : null : line;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const begin = (action: Snapshot["action"]) => {
    if (full?.entry?.scope !== "affaire") return;
    setSnapshot({ action, source: full.entry, plans: full.readings.map(r => ({ key: r.planKey, name: r.planName, revision: r.entry?.revision ?? 0,
      unavailable: entryReadingReason(r) })) });
  };
  if (read.error) return <p role="alert">Impossible de relire la saisie de l’affaire.</p>;
  return <>
    {full?.entry?.scope === "affaire" && <div className="flex flex-wrap gap-2">
      <Button size="xs" variant="outline" onClick={() => begin("attach")}>{titles.attach}</Button>
      <Button size="xs" variant="outline" onClick={() => begin("withdraw")}>{titles.withdraw}</Button>
    </div>}
    {snapshot && <ScopeDialog snapshot={snapshot} projectId={projectId} onRefused={onRefused}
      close={(refresh, uncertain) => { setSnapshot(null); if (refresh) onRefresh(uncertain); }} />}
  </>;
}

function ScopeDialog({ snapshot, projectId, onRefused, close }: {
  snapshot: Snapshot; projectId: string; onRefused: (error: unknown) => boolean; close: (refresh: boolean, uncertain?: boolean) => void;
}) {
  const { source, plans, action } = snapshot;
  const field = useId();
  const [key, setKey] = useState("");
  const [intent, setIntent] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<EntryScopeResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const eligible = plans.filter(p => !p.unavailable);
  const plan = eligible.find(p => p.key === key);
  const collision = result?.outcome === "collision" ? result.entry : null;
  useEffect(() => { if (collision) cancel.current?.focus(); }, [collision]);
  const refused = result && result.outcome in messages ? messages[result.outcome as keyof typeof messages] : null;
  const dismiss = () => { if (!sending.current) close(!!refused || !!error, !!error); };
  async function submit(replace = false) {
    if (sending.current || refused || (action === "attach" && !plan) || (replace !== !!collision)) return;
    const base = { entry_revision: source.revision, intent_key: intent };
    const command: EntryScopeCommand = action === "withdraw" ? { ...base, action }
      : { ...base, action: replace ? "replace" : "attach", plan_id: plan!.key, plan_entry_revision: collision?.revision ?? plan!.revision };
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await sendEntryScope(projectId, source.itemId, command);
      if (response.outcome === "applied") close(true);
      else {
        setResult(response);
        if (response.outcome === "collision") setIntent(crypto.randomUUID());
      }
    } catch (caught) {
      if (!onRefused(caught)) setError("Impossible de confirmer le geste. Vous pouvez réessayer.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent size="sm">
      <DialogHeader>
        <DialogTitle>{titles[action]}</DialogTitle>
        <DialogDescription>Total de toute l’affaire · {formatEntryQuantity(source.quantity, source.unit)} · {QUANTITY_ENTRY_CATEGORIES[source.category]}
          {source.note && ` · ${source.note}`}</DialogDescription>
      </DialogHeader>
      {action === "attach" && <Field>
        <FieldLabel htmlFor={field}>Plan de destination</FieldLabel>
        <NativeSelect id={field} value={key} disabled={busy || !!collision || !!refused || !!error}
          onChange={e => { setKey(e.target.value); setIntent(crypto.randomUUID()); setError(""); }}>
          <option value="">Choisir un plan…</option>
          {eligible.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
        </NativeSelect>
        {plans.filter(p => p.unavailable).map(p => <p key={p.key}>{p.name} · {p.unavailable}</p>)}
        {!eligible.length && <p>Aucun plan avec une lecture incertaine ou non trouvée pour ce poste.</p>}
      </Field>}
      {action === "withdraw" && <p>Le poste retrouvera la quantité issue de ses lectures.</p>}
      {collision && <div role="status">
        <p>Une saisie existe déjà sur « {plan?.name} ».</p>
        <p>{formatEntryQuantity(collision.quantity, collision.unit)} · {QUANTITY_ENTRY_CATEGORIES[collision.category]}
          {" · "}{collision.author}, le {date.format(new Date(collision.entered_at))}</p>
      </div>}
      {(refused || error) && <p role="alert">{refused || error}</p>}
      <DialogFooter>
        <Button ref={cancel} disabled={busy} variant="outline" onClick={dismiss}>{refused ? "Revenir au poste" : "Annuler"}</Button>
        {!refused && (collision
          ? <Button variant="danger" disabled={busy} onClick={() => void submit(true)}>Remplacer la saisie du plan</Button>
          : <Button disabled={busy || (action === "attach" && !plan)} onClick={() => void submit()}>{action === "attach" ? "Rattacher" : "Retirer"}</Button>)}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
