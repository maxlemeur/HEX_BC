"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { coverageTargetsSchema, type CoverageTargetFact, type CoverageTargets } from "@/lib/estimates/source-coverage-contracts";

import { coverageJson } from "./source-coverage-client";
import { CoverageFact } from "./CoverageFacts";

export function CoverageTargetPicker({ versionId, sectionOnly = false, disabled, onPick }: Readonly<{
  versionId: string; sectionOnly?: boolean; disabled: boolean;
  onPick: (option: { id: string; title: string; fact: CoverageTargetFact | null }) => void;
}>) {
  const [kind, setKind] = useState<"line" | "component" | "register" | "section">(sectionOnly ? "section" : "line");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<CoverageTargets | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const queryRef = useRef<{ kind: typeof kind; search: string } | null>(null);

  async function load(append = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const params = new URLSearchParams({ kind, search: search.trim(), limit: "20" });
    if (append && result?.nextAfterId) params.set("afterId", result.nextAfterId);
    if (!append) setResult(null);
    setBusy(true); setFailure(null);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 75_000);
    try {
      const value = await coverageJson(`/api/estimates/${versionId}/source-review/requirements/targets?${params}`, coverageTargetsSchema, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      queryRef.current = { kind, search: search.trim() };
      setResult((previous) => append && previous ? { ...value, items: [...previous.items, ...value.items.filter((item) => !previous.items.some((old) => old.id === item.id))] } : value);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) setFailure(error instanceof Error ? error.message : "Les cibles sont indisponibles.");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { if (timedOut) setFailure("La recherche a dépassé le délai autorisé. Réessayez."); setBusy(false); request.current = null; }
    }
  }
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const changed = queryRef.current?.kind !== kind || queryRef.current?.search !== search.trim();

  return <section aria-label={sectionOnly ? "Sélection du lot DPGF" : "Recherche de cibles"} className="space-y-3 rounded-lg border border-border p-4">
    {!sectionOnly ? <label className="block space-y-1 text-sm"><span>Type de cible</span><NativeSelect value={kind} disabled={disabled || busy} onChange={(event) => { setKind(event.target.value as typeof kind); setResult(null); }}>
      <option value="line">Ligne</option><option value="component">Composant appliqué</option><option value="register">Registre</option>
    </NativeSelect></label> : null}
    <label className="block space-y-1 text-sm"><span>{sectionOnly ? "Recherche de lot DPGF" : "Recherche de cible"}</span><Input value={search} maxLength={200} disabled={disabled || busy} onChange={(event) => setSearch(event.target.value)} /></label>
    <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void load()}>{busy ? "Recherche en cours…" : sectionOnly ? "Rechercher les lots DPGF" : "Rechercher les cibles"}</Button>
    {failure ? <Alert variant="danger">{failure}</Alert> : null}
    {!changed && result ? <div className="space-y-3">
      {result.items.length === 0 ? <p className="text-sm text-muted-foreground">Aucune cible trouvée pour cette recherche.</p> : null}
      {result.items.map((option) => <div key={option.id} data-testid={`coverage-target-${option.id}`} className="space-y-2 rounded-lg bg-muted/40 p-3">
        {option.fact ? <CoverageFact fact={option.fact} /> : <p className="font-medium">{option.title}</p>}
        {kind === "component" ? option.components.filter((fact) => fact.kind === "component").map((fact) => fact.kind === "component" ? <div key={`${fact.applicationId}:${fact.componentId}`} data-testid={`coverage-component-${fact.applicationId}-${fact.componentId}`} className="ml-3 space-y-2 border-l border-border pl-3">
          <CoverageFact fact={fact} /><Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => onPick({ id: option.id, title: fact.title, fact })}>Lier ce composant</Button>
        </div> : null) : <Button type="button" size="sm" variant="outline" disabled={disabled || busy || (!sectionOnly && !option.fact)} onClick={() => onPick(option)}>{sectionOnly ? "Choisir ce lot DPGF" : "Lier cette cible"}</Button>}
      </div>)}
      {result.nextAfterId ? <Button type="button" variant="ghost" disabled={disabled || busy} onClick={() => void load(true)}>Afficher les cibles suivantes</Button> : null}
    </div> : null}
  </section>;
}
