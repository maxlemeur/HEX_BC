"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { sendFindDecision } from "@/lib/takeoff/item-table-client";
import { ITEM_REVIEW_LIMITS } from "@/lib/takeoff/item-table";
import { FIND_REASONS, type FindCommand, type FindsView, type UnlistedFind } from "@/lib/takeoff/unlisted-finds";

const coord = (f: UnlistedFind) => `${f.jobId}/${f.index}`;

export function FindSource({ find, decision }: { find: UnlistedFind; decision?: { projectId: string; id: string } }) {
  const query = decision && find.documentId ? `?${new URLSearchParams({ projectId: decision.projectId, decisionId: decision.id })}` : "";
  return <div className="min-w-0 space-y-1 whitespace-normal text-sm font-normal">
    <p>{find.planName} · page {find.page}</p>
    <p className="break-words text-muted-foreground">{find.evidence}</p>
    <a className="underline" target="_blank" rel="noreferrer"
      href={`/api/takeoff/jobs/${find.jobId}/vector-plans/${find.fileId}${query}#page=${find.page}`}>Voir le plan — page {find.page}</a>
  </div>;
}

type Editor = { kind: "add" | "dismiss"; finds: UnlistedFind[]; revision: number; key: string };
type Section = Extract<FindCommand,{kind: "add"}>["entries"][number]["section"];

function AdditionFields({ find, sections, index }: { find: UnlistedFind; sections: FindsView["sections"]; index: number }) {
  const [choice,setChoice] = useState("default");
  return <fieldset className="min-w-0 space-y-2 rounded border p-3">
    <legend className="px-1 text-sm font-medium">{find.designation}</legend>
    <label className="block text-sm">Désignation<Input name={`label-${index}`} defaultValue={find.designation} required maxLength={4000} /></label>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">Unité<Input name={`unit-${index}`} required maxLength={32} placeholder="u, m, m²…" /></label>
      <label className="text-sm">Section<NativeSelect name={`section-${index}`} value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="default">Postes ajoutés</option>
        {sections.map(s => <option value={s.itemId} key={s.itemId}>{s.name}</option>)}
        <option value="new">Nouvelle section…</option>
      </NativeSelect></label>
    </div>
    {choice === "new" && <label className="block text-sm">Nom de la nouvelle section<Input required maxLength={120} name={`title-${index}`} /></label>}
  </fieldset>;
}

export function UnlistedFinds({ view, projectId, planKey, refresh, measure }: {
  view: FindsView; projectId: string; planKey: string | null; refresh: (kind: FindCommand["kind"]) => Promise<unknown>;
  measure: (plan: string, name: string, items: string[]) => void;
}) {
  const inScope = (entry: { planKey: string }) => !planKey || planKey === entry.planKey;
  const finds = view.finds.filter(inScope);
  const dismissed = view.decisions.filter(d => !d.itemId && inScope(d));
  const [selected,setSelected] = useState<string[]>([]);
  const [editor,setEditor] = useState<Editor | null>(null);
  const [reason,setReason] = useState<keyof typeof FIND_REASONS>("outside_scope");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [added,setAdded] = useState<string[]>([]);
  const justAdded = view.decisions.filter(d => d.itemId && added.includes(d.itemId) && inScope(d));
  const selectedFinds = finds.filter(find => selected.includes(coord(find)));
  function edit(kind: Editor["kind"], items: UnlistedFind[]) {
    setError("");
    setReason("outside_scope");
    setEditor({ kind, finds: items, key: crypto.randomUUID(), revision: view.revision });
  }
  async function save(command: FindCommand) {
    setBusy(true);
    setError("");
    try {
      const result = await sendFindDecision(projectId,command);
      if (command.kind === "add") {
        setAdded(result.itemIds);
        setSelected([]);
        setMessage(result.itemIds.length === 1 ? "Un poste ajouté à la liste. Aucune mesure lancée."
          : `${result.itemIds.length} postes ajoutés à la liste. Aucune mesure lancée.`);
      } else setMessage(command.kind === "undo" ? "Mise à l’écart annulée." : "Ouvrage écarté.");
      setEditor(null);
      await refresh(command.kind);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer la décision."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    if (editor.kind === "dismiss") {
      const [find] = editor.finds;
      void save({ kind: "dismiss", jobId: find.jobId, index: find.index, intentKey: editor.key, reason,
        ...(reason === "other" && { detail: value("detail") }) });
    } else {
      const entries = editor.finds.map((find,i) => {
        const choice = value(`section-${i}`);
        const section: Section = choice === "default" ? { kind: "default" } : choice === "new"
          ? { kind: "new", title: value(`title-${i}`) } : { kind: "existing", itemId: choice };
        return { jobId: find.jobId, index: find.index, label: value(`label-${i}`), unit: value(`unit-${i}`), section };
      });
      void save({ kind: "add", expectedRevision: editor.revision, intentKey: editor.key, entries });
    }
  }
  const truncated = view.notices.filter(n => n.truncated && inScope(n));
  if (!finds.length && !dismissed.length && !view.notices.some(inScope) && !message && !justAdded.length) return null;
  return <section className="space-y-3 rounded-lg border p-3" id="ouvrages-hors-liste" aria-labelledby="titre-hors-liste">
    <h3 id="titre-hors-liste" className="font-semibold">Ouvrages vus sur le plan, hors liste ({finds.length})</h3>
    {truncated.map((n,i) => <p key={i} className="text-sm text-warning">{n.planName} · la lecture a vu davantage d’ouvrages hors liste que ceux affichés.</p>)}
    {view.canWrite && selectedFinds.length > 0 && <Button size="sm" onClick={() => edit("add",selectedFinds)}>Ajouter les {selectedFinds.length} ouvrages à la liste</Button>}
    <ul className="divide-y">{finds.map(f => <li key={coord(f)} className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 gap-2">
        {view.canWrite && <input type="checkbox" className="mt-1" aria-label={`Sélectionner l’ouvrage « ${f.designation} »`}
          checked={selected.includes(coord(f))} onChange={e => setSelected(e.target.checked ? [...selected,coord(f)] : selected.filter(id => id !== coord(f)))} />}
        <div className="min-w-0"><strong className="break-words text-sm">{f.designation}</strong><FindSource find={f} /></div>
      </div>
      {view.canWrite && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => edit("add",[f])}>Ajouter à la liste</Button>
        <Button size="sm" variant="ghost" onClick={() => edit("dismiss",[f])}>Écarter</Button></div>}
    </li>)}</ul>
    {dismissed.length > 0 && <details><summary className="cursor-pointer text-sm">{dismissed.length} écarté{dismissed.length > 1 ? "s" : ""}</summary>
      <ul className="divide-y">{dismissed.map(d => <li key={d.id} className="space-y-1 py-2"><strong>{d.designation}</strong>
        <FindSource find={d} decision={{ projectId, id: d.id }} />
        <p className="text-sm">{d.reason && FIND_REASONS[d.reason]}{d.detail && ` · ${d.detail}`} · {d.author} · {new Date(d.date).toLocaleString("fr-FR")}</p>
        {view.canWrite && <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ kind: "undo", decisionId: d.id })}>Annuler la mise à l’écart</Button>}
      </li>)}</ul></details>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {view.canWrite && [...new Set(justAdded.map(d => d.planKey))].map(plan => {
      const group = justAdded.filter(d => d.planKey === plan);
      return Array.from({ length: Math.ceil(group.length / ITEM_REVIEW_LIMITS.items) }, (_,index) => {
        const start = index * ITEM_REVIEW_LIMITS.items;
        const batch = group.slice(start,start + ITEM_REVIEW_LIMITS.items);
        return <Button key={`${plan}/${start}`} size="sm" variant="outline" onClick={() => measure(plan,batch[0].planName,batch.map(d => d.itemId!))}>
          Mesurer les postes ajoutés sur {batch[0].planName} ({group.length > batch.length ? `${start + 1}–${start + batch.length}` : batch.length})</Button>;
      });
    })}
    {error && !editor && <p role="alert">{error}</p>}
    {view.canWrite && editor && <Dialog open onOpenChange={open => { if (!open && !busy) setEditor(null); }}>
      <DialogContent size="md"><DialogHeader><DialogTitle>{editor.kind === "add" ? "Ajouter à la liste" : "Écarter l’ouvrage"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {editor.kind === "add" ? editor.finds.map((f,i) => <AdditionFields key={coord(f)} find={f} sections={view.sections} index={i} />)
              : <><p>{editor.finds[0].designation}</p><label className="block text-sm">Motif<NativeSelect value={reason}
                onChange={e => setReason(e.target.value as typeof reason)}>{Object.entries(FIND_REASONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label>
                {reason === "other" && <label className="block text-sm">Précisez le motif<Input name="detail" required maxLength={300} /></label>}</>}
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(null)}>Annuler</Button>
            <Button type="submit" disabled={busy}>{editor.kind === "add" ? "Confirmer l’ajout" : "Confirmer la mise à l’écart"}</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>}
  </section>;
}
