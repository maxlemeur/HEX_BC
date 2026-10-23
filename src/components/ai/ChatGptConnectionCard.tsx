"use client";

import { useCallback, useEffect, useState } from "react";

import {
  chooseChatGptAccount, chooseChatGptModel, connectChatGpt, disconnectChatGpt,
  loadChatGptConnection, loadChatGptModels, testChatGptConnection,
} from "@/app/dashboard/_actions/chatgpt";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Connection = NonNullable<Awaited<ReturnType<typeof loadChatGptConnection>>>;

export function ChatGptConnectionCard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);

  const reload = useCallback(async () => {
    const state = await loadChatGptConnection();
    setConnection(state);
    setModels([]);
    if (state?.sharing) setModels(await loadChatGptModels());
    return state;
  }, []);

  useEffect(() => {
    if (window.location.hostname !== "127.0.0.1") return;
    const query = new URLSearchParams(window.location.search);
    const connected = query.get("chatgpt") === "connected";
    if (query.get("chatgpt") === "failed") setError("La connexion ChatGPT n’a pas abouti. Réessayez en autorisant l’utilisation du forfait.");
    if (query.has("chatgpt")) {
      query.delete("chatgpt");
      window.history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
    }
    void reload().then((state) => {
      if (connected && state?.sharing && state.selectedId) {
        const key = `mergeone-chatgpt-welcome-${state.selectedId}`;
        try {
          if (!window.localStorage.getItem(key)) { setWelcome(true); window.localStorage.setItem(key, "shown"); }
        } catch { setWelcome(true); }
      }
    }).catch(() => setError("Impossible de charger la connexion ChatGPT. Réessayez dans quelques instants."));
  }, [reload]);

  async function run(effect: () => Promise<unknown>) {
    setBusy(true); setError(null); setMessage(null);
    try { await effect(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "La demande ChatGPT a échoué."); }
    finally { setBusy(false); }
  }

  if (!connection) return null;
  const selected = connection.profiles.find((profile) => profile.id === connection.selectedId);
  const selectClass = "mt-2 w-full rounded-md border border-border bg-surface p-2 text-sm text-foreground";

  return (
    <PageSection title="Mon forfait ChatGPT" className="mt-6 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Connectez votre forfait ChatGPT Plus ou Pro pour le classement des documents,
        le brief, les ouvrages et les explications IA dans MergeOne sur ce Mac.
        Le métré différé continue d’utiliser Gemini.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Les demandes consomment les limites de votre forfait. Vos conversations ChatGPT
        ne sont pas accessibles à MergeOne. La connexion est propre à votre compte et à votre tenant actif.
      </p>

      {welcome && connection.sharing ? (
        <Alert variant="success" className="mt-4">
          <p>Vous utilisez votre forfait ChatGPT. Gérez ses limites dans les paramètres ChatGPT.</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => setWelcome(false)}>Compris</Button>
        </Alert>
      ) : null}

      {connection.profiles.length > 0 ? (
        <label className="mt-4 block text-sm font-medium">
          Compte ChatGPT
          <select className={selectClass} disabled={busy} value={connection.selectedId ?? ""}
            onChange={(event) => void run(async () => { await chooseChatGptAccount(event.target.value); await reload(); })}>
            <option value="" disabled>Choisir une connexion</option>
            {connection.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label} · {profile.email || "Inscription à reprendre"}{profile.connected ? "" : " · déconnectée"}</option>
            ))}
          </select>
        </label>
      ) : null}

      {connection.sharing ? (
        <>
          <p role="status" className="mt-4 text-sm font-medium">Forfait ChatGPT activé · {selected?.email}</p>
          <label className="mt-4 block text-sm font-medium">
            Modèle ChatGPT
            <select className={selectClass} disabled={busy} value={connection.model ?? ""}
              onChange={(event) => void run(async () => { await chooseChatGptModel(event.target.value); await reload(); })}>
              <option value="" disabled>Choisir un modèle de votre forfait</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">Les formats acceptés dépendent du modèle choisi. Les documents nécessaires à la demande sont transmis à OpenAI.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={busy || !connection.model}
              onClick={() => void run(async () => {
                const result = await testChatGptConnection();
                if (result.success) setMessage(`Connexion vérifiée avec ${result.model}. Cette vérification a utilisé votre forfait.`);
              })}>Tester la connexion</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(reload)}>Actualiser les modèles</Button>
          </div>
        </>
      ) : selected?.connected ? (
        <Alert variant="info" className="mt-4">Compte connecté. Autorisez l’utilisation du forfait en vous reconnectant.</Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy} variant="outline" onClick={() => void run(async () => {
          const result = await connectChatGpt(selected?.id);
          window.location.assign(result.url);
        })}>Continue with ChatGPT</Button>
        {connection.profiles.length > 0 ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
            const result = await connectChatGpt(); window.location.assign(result.url);
          })}>Ajouter un compte</Button>
        ) : null}
        {selected ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
            const result = await disconnectChatGpt(); await reload();
            setWelcome(false);
            setMessage(result.revocationConfirmed ? "ChatGPT déconnecté. Les fonctions IA reprennent leur configuration habituelle." :
              "Connexion supprimée de ce Mac. La révocation distante n’a pas pu être confirmée : déconnectez aussi MergeOne dans les paramètres de sécurité ChatGPT.");
          })}>Déconnecter ChatGPT</Button>
        ) : null}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline">Gérer ma consommation</a>
      </div>
      {error ? <Alert variant="danger" className="mt-4">{error}</Alert> : null}
      {message ? <Alert variant="info" className="mt-4">{message}</Alert> : null}
    </PageSection>
  );
}
