"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import { useEffect, useId, useState } from "react";

import { loadTakeoffPreparationProfilesAction, saveTakeoffPreparationProfileAction } from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  applyTakeoffPreparationProfile, createTakeoffPreparationProfile,
  type TakeoffPreparation, type TakeoffPreparationProfile,
} from "@/lib/takeoff/preparation";

export function TakeoffPreparationProfiles({ draft, onChange }: { draft: TakeoffPreparation; onChange: (draft: TakeoffPreparation) => void }) {
  const id = useId();
  const [profiles, setProfiles] = useState<TakeoffPreparationProfile[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadTakeoffPreparationProfilesAction().then((result) => { const profiles = unwrapTakeoffActionResult(result); if (active) setProfiles(profiles); }).catch((cause) => { if (active) setMessage(cause instanceof TakeoffActionError ? cause.message : "Les profils ne sont pas disponibles. Le cadrage manuel reste possible."); });
    return () => { active = false; };
  }, []);
  async function saveProfile() {
    setBusy(true);
    setMessage(null);
    try {
      const profile = createTakeoffPreparationProfile({ preparation: draft, id: crypto.randomUUID(), name: name.trim(), version: 1 });
      const saved = unwrapTakeoffActionResult(await saveTakeoffPreparationProfileAction({ profile, expectedVersion: null }));
      setProfiles((previous) => [...previous, saved]);
      setSelected(saved.id);
      setName("");
      setMessage("Profil enregistré. Les sources, zones et confirmations de cette affaire restent propres à la préparation.");
    } catch (cause) { setMessage(cause instanceof TakeoffActionError ? cause.message : "Impossible d'enregistrer ce profil."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">Réutiliser un profil métier</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">Un profil reprend l&apos;objectif, les lots, les réseaux et les conventions. Son application est proposée au brouillon et demande une nouvelle confirmation.</p>
      <label htmlFor={`${id}-profile`} className="block space-y-1"><span>Profil métier</span><NativeSelect id={`${id}-profile`} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choisir un profil enregistré</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · version {profile.version}</option>)}</NativeSelect></label>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!selected || busy} onClick={() => { const profile = profiles.find((item) => item.id === selected); if (profile) { onChange(applyTakeoffPreparationProfile(draft, profile)); setMessage("Profil repris dans le brouillon. Vérifiez et confirmez les champs modifiés."); } }}>Appliquer le profil au brouillon</button>
      <label htmlFor={`${id}-name`} className="block space-y-1"><span>Nom du nouveau profil</span><Input id={`${id}-name`} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={!name.trim() || busy} onClick={() => void saveProfile()}>{busy ? "Enregistrement du profil…" : "Enregistrer ce cadrage comme profil"}</button>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  </details>;
}
