"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { loadChatGptConnection } from "@/app/dashboard/_actions/chatgpt";
import type { TakeoffProvider } from "@/lib/takeoff/types";

export function TakeoffProviderSelect({ value, onChange, disabled, preserveAutomaticChoice = false }: {
  value: TakeoffProvider;
  onChange: (provider: TakeoffProvider) => void;
  disabled?: boolean;
  preserveAutomaticChoice?: boolean;
}) {
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof loadChatGptConnection>>>(null);
  useEffect(() => {
    let active = true;
    void loadChatGptConnection().then((state) => { if (active) setConnection(state); }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  const available = Boolean(connection?.sharing && connection?.model);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">Fournisseur IA</label>
      <select id={id} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value as TakeoffProvider)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
        aria-describedby={`${id}-help`}>
        <option value="auto">{preserveAutomaticChoice ? "Automatique — fournisseur de la demande confirmée" : "Automatique — forfait ChatGPT local"}</option>
        <option value="chatgpt" disabled={!available}>ChatGPT — forfait local{connection?.model ? ` (${connection.model})` : loaded ? " indisponible ou à connecter" : " vérification…"}</option>
        {value === "gemini" && <option value="gemini" disabled>Ancien fournisseur indisponible — choisissez ChatGPT</option>}
      </select>
      {value === "gemini" && <p role="status" className="text-xs text-warning">Cet ancien fournisseur est indisponible. Choisissez ChatGPT et confirmez à nouveau la préparation.</p>}
      {loaded && !available && value !== "gemini" && <p role="status" className="text-xs text-warning">Connectez votre forfait ChatGPT et choisissez un modèle dans Mon profil pour lancer le métré.</p>}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Le métré utilise le forfait ChatGPT local et consomme ses limites. Le fournisseur reste fixé pour cette extraction.
        {" "}<Link href="/dashboard/profile" className="underline">Gérer mon forfait ChatGPT</Link>
      </p>
    </div>
  );
}
