"use client";

import Link from "next/link";
import { useId } from "react";

import type { loadChatGptConnection } from "@/app/dashboard/_actions/chatgpt";
import type { TakeoffProvider } from "@/lib/takeoff/types";

export type ChatGptConnection = Awaited<ReturnType<typeof loadChatGptConnection>>;

/**
 * `connection` comes from the preparation panel, which reads it when it opens: read here when the select appeared,
 * it waited in the page's queue of Server Actions in front of the person's save (TI-720).
 */
export function TakeoffProviderSelect({ value, onChange, connection, disabled, preserveAutomaticChoice = false }: {
  value: TakeoffProvider;
  onChange: (provider: TakeoffProvider) => void;
  connection: ChatGptConnection;
  disabled?: boolean;
  preserveAutomaticChoice?: boolean;
}) {
  const id = useId();
  const available = Boolean(connection?.sharing && connection?.model);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">Fournisseur IA</label>
      <select id={id} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value as TakeoffProvider)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
        aria-describedby={`${id}-help`}>
        <option value="auto">{preserveAutomaticChoice ? "Automatique — fournisseur de la demande confirmée" : "Automatique — forfait ChatGPT local"}</option>
        <option value="chatgpt" disabled={!available}>ChatGPT — forfait local{connection?.model ? ` (${connection.model})` : " indisponible ou à connecter"}</option>
        {value === "gemini" && <option value="gemini" disabled>Ancien fournisseur indisponible — choisissez ChatGPT</option>}
      </select>
      {value === "gemini" && <p role="status" className="text-xs text-warning">Cet ancien fournisseur est indisponible. Choisissez ChatGPT et confirmez à nouveau la préparation.</p>}
      {!available && value !== "gemini" && <p role="status" className="text-xs text-warning">Connectez votre forfait ChatGPT et choisissez un modèle dans Mon profil pour lancer le métré.</p>}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Le métré utilise le forfait ChatGPT local et consomme ses limites. Le fournisseur reste fixé pour cette extraction.
        {" "}<Link href="/dashboard/profile" className="underline">Gérer mon forfait ChatGPT</Link>
      </p>
    </div>
  );
}
