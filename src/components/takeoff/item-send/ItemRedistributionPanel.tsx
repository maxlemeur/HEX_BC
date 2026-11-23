"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { isTakeoffApiError, requestItemRedistribution } from "@/lib/takeoff/client";
import type { RedistributionOption, RedistributionPreview } from "@/lib/takeoff/item-redistribution-contracts";
import { ITEM_SEND_BREAKDOWN_LABELS, type ItemSendBreakdown } from "@/lib/takeoff/item-send-plan";

const reasons: Record<RedistributionPreview["blockers"][number]["reason"], string> = {
  location_unavailable: "ce plan a été remplacé ou sa localisation ne peut plus être lue. La redistribution est bloquée",
  unchanged: "les apports occupent déjà les lignes de ce découpage",
  edited: "ligne modifiée ou chiffrée dans le devis", quantity: "quantité saisie dans le devis",
  section: "section personnalisée", used: "ligne utilisée ailleurs", identity: "apports de caractéristiques différentes",
  dpgf: "la ligne du DPGF conserve son emplacement", deleted: "ligne supprimée dans l’éditeur",
  mixed: "les apports du poste utilisent plusieurs découpages", depth: "profondeur maximale des sections atteinte",
  quantity_limit: "quantité supérieure au plafond du devis",
};

const locationStates: Record<string, string> = { confirmed: "confirmé", corrected: "saisi", proposed: "lu, à confirmer",
  unknown: "inconnu", multiple: "plusieurs valeurs lues" };

const quantity = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
const intentions = new Map<string, string>();

export function ItemRedistributionPanel({ jobId, viewerKey, versionId, disabled = false, onBusyChange, onChanged }: {
  jobId: string; viewerKey: string; versionId?: string; disabled?: boolean; onBusyChange?: (busy: boolean) => void; onChanged?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [options, setOptions] = useState<RedistributionOption[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<ItemSendBreakdown>("together");
  const [preview, setPreview] = useState<RedistributionPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const running = useRef(false);
  const option = options.find((row) => row.version_id + row.item_id === selected) ?? options[0];

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void requestItemRedistribution(jobId, { action: "list" }, controller.signal).then((response) => {
      if (!controller.signal.aborted && response.action === "list") {
        setLoaded(true);
        setOptions(response.options.filter((row) => !versionId || row.version_id === versionId));
      }
    }).catch(() => { if (!controller.signal.aborted) setMessage("Impossible de lire les apports de ce devis."); });
    return () => { active.current = false; controller.abort(); };
  }, [jobId, versionId]);

  function reset() {
    setPreview(null);
    setMessage("");
  }

  async function run(confirm: boolean) {
    if (disabled || !option || running.current || (confirm && !preview)) return;
    const selection = { version_id: option.version_id, item_id: option.item_id, breakdown: mode };
    running.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setMessage("");
    let release = false;
    try {
      if (!confirm || !preview) {
        setPreview(null);
        const read = await requestItemRedistribution(jobId, { action: "preview", ...selection });
        if (active.current && read.action === "preview") setPreview(read.preview);
        return;
      }
      const lock = await ensureTakeoffApplyDraftLock(option.version_id);
      release = lock.shouldRelease || (lock.acquireAttempted === true && !lock.lockedByOther);
      if (!lock.acquired) throw new Error(lock.errorMessage ?? "Le brouillon ne vous est plus réservé.");
      if (!active.current) return;
      const key = [viewerKey, option.version_id, option.item_id, preview.digest].join("/");
      const requestId = intentions.get(key) ?? crypto.randomUUID();
      intentions.set(key, requestId);
      await requestItemRedistribution(jobId, { action: "confirm", ...selection, digest: preview.digest, request_id: requestId });
      intentions.delete(key);
      if (active.current) {
        setPreview(null);
        setMessage("Redistribution enregistrée.");
        onChanged?.();
      }
    } catch (error) {
      if (!active.current) return;
      setMessage(error instanceof Error ? error.message : "Impossible de vérifier la redistribution.");
      if (isTakeoffApiError(error) && [401, 403, 409, 422].includes(error.status)) {
        setPreview(null);
        if (error.status === 403 || error.status === 401) setOptions([]);
        else if (error.status === 409) {
          const latest = await requestItemRedistribution(jobId, { action: "preview", ...selection }).catch(() => null);
          if (active.current && latest?.action === "preview") setPreview(latest.preview);
        }
      }
    } finally {
      if (release) await releaseEstimateDraftLock(option.version_id).catch(() => false);
      onBusyChange?.(false);
      running.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!option) {
    if (message) return <Alert variant="warning">{message}</Alert>;
    if (!versionId) return <p role="status">{loaded ? "Aucun apport à redistribuer dans cette affaire." : "Lecture des apports…"}</p>;
    return null;
  }
  return <section className="space-y-3" aria-label="Redistribution après envoi">
    <h3 className="font-semibold">Redistribuer les apports déjà envoyés</h3>
    <label className="block">Poste et devis
      <select className="form-input" disabled={disabled || busy} value={option.version_id + option.item_id} onChange={(event) => {
        setSelected(event.target.value); reset();
      }}>
        {options.map((row) => <option key={row.version_id + row.item_id} value={row.version_id + row.item_id}>
          V{row.version_number} · {row.title}
        </option>)}
      </select>
    </label>
    <label className="block">Nouveau découpage
      <select className="form-input" value={mode} disabled={disabled || busy} onChange={(event) => {
        setMode(event.target.value as ItemSendBreakdown); reset();
      }}>
        {(["together", "by_level", "by_building"] as const).map((value) =>
          <option key={value} value={value}>{ITEM_SEND_BREAKDOWN_LABELS[value]}</option>)}
      </select>
    </label>
    <Button variant="outline" disabled={disabled || busy} onClick={() => void run(false)}>Prévisualiser la redistribution</Button>
    {message ? <p role="status">{message}</p> : null}
    {preview ? <section aria-label="Déplacements des apports" className="space-y-2">
      <h4 className="font-medium">Lignes actuelles</h4>
      <ul>{preview.sources.map((source) => <li key={source.target_id}>
        {source.title} · {source.label} · {source.quantity === null ? "ligne supprimée" : `${quantity(source.quantity)} ${source.unit}`}
        {source.line_id && preview.remove_lines.includes(source.line_id) ? " · retrait prévu" : ""}
        {source.price_cents !== null ? ` · PU ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: preview.currency }).format(source.price_cents / 100)}` : ""}
        {source.hours_per_unit !== null ? ` · ${quantity(source.hours_per_unit)} h/u` : ""}
        {source.tax_rate_bp !== null ? ` · TVA ${quantity(source.tax_rate_bp / 100)} %` : ""}
        {` · K FO ${source.k_fo ?? "—"} · K MO ${source.k_mo ?? "—"}`}
      </li>)}</ul>
      <h4 className="font-medium">Répartition proposée</h4>
      <ul>{preview.destinations.map((dest) => <li key={dest.key}>
        {dest.label} · {quantity(dest.quantity)} {preview.sources[0]?.unit}
        {dest.raw !== dest.quantity ? ` (avant arrondi : ${quantity(dest.raw)})` : ""}
      </li>)}</ul>
      <ul>{preview.parts.map((part) => <li key={part.id}>
        {part.plan_name} · {preview.sources.find((source) => source.target_id === part.from_target)?.label} · {quantity(part.quantity)} {part.unit}
        {part.pages.length ? ` · p. ${part.pages.join(", ")}` : ""} → {part.label ?? "Localisation indisponible"}
        {part.available && ` · bâtiment ${locationStates[part.building_state ?? "unknown"]} · niveau ${locationStates[part.level_state ?? "unknown"]}`}
      </li>)}</ul>
      {preview.blockers.length ? <Alert variant="warning">
        {preview.blockers.map((blocker, index) => <p key={index}>{blocker.title} · {reasons[blocker.reason]}.</p>)}
        <p>Ouvrez le devis pour décider des lignes à conserver ou créer un brouillon distinct.</p>
        <a className="underline" href={`/dashboard/estimates/${option.version_id}/edit`}>Ouvrir le devis V{option.version_number}</a>
      </Alert> : null}
      <Button disabled={disabled || busy || preview.blockers.length > 0} onClick={() => void run(true)}>Confirmer la redistribution</Button>
    </section> : null}
  </section>;
}
