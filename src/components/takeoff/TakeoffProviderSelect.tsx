"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { loadChatGptConnection } from "@/app/dashboard/_actions/chatgpt";
import type { TakeoffProvider } from "@/lib/takeoff/types";

export function TakeoffProviderSelect({ value, onChange, disabled }: {
  value: TakeoffProvider;
  onChange: (provider: TakeoffProvider) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof loadChatGptConnection>>>(null);
  useEffect(() => {
    let active = true;
    void loadChatGptConnection().then((state) => { if (active) setConnection(state); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!connection) return null;
  const available = Boolean(connection.sharing && connection.model);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">Fournisseur IA</label>
      <select id={id} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value as TakeoffProvider)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
        aria-describedby={`${id}-help`}>
        <option value="auto">Automatique — {available ? "forfait ChatGPT" : "Gemini"}</option>
        <option value="chatgpt" disabled={!available}>ChatGPT — forfait local{connection.model ? ` (${connection.model})` : " à connecter"}</option>
        <option value="gemini">Gemini — API</option>
      </select>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        ChatGPT consomme les limites de votre forfait. Gemini utilise la configuration API de MergeOne.
        Le fournisseur choisi reste fixé pour cette extraction.
        {" "}<Link href="/dashboard/profile" className="underline">Gérer mon forfait ChatGPT</Link>
      </p>
    </div>
  );
}
