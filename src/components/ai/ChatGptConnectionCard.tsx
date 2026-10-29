"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";

import {
  chooseChatGptAccount,
  chooseChatGptPreferences,
  connectChatGpt,
  disconnectChatGpt,
  loadChatGptConnection,
  loadChatGptModels,
  testChatGptConnection,
} from "@/app/dashboard/_actions/chatgpt";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { InfoPopover } from "@/components/ui/info-popover";
import { NativeSelect } from "@/components/ui/native-select";
import { chatGptSignInErrorMessage } from "@/lib/ai/chatgpt-sign-in-errors";

type Connection = NonNullable<
  Awaited<ReturnType<typeof loadChatGptConnection>>
>;
type Models = Awaited<ReturnType<typeof loadChatGptModels>>;
type ReasoningEffort = NonNullable<Connection["reasoningEffort"]>;

const effortLabels: Record<ReasoningEffort, string> = {
  none: "Sans raisonnement",
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximum",
};

export function ChatGptConnectionCard() {
  const id = useId();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<Models>([]);
  const [busy, setBusy] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);

  const reload = useCallback(async () => {
    let state = await loadChatGptConnection();
    setConnection(state);
    setModels([]);
    if (state?.sharing) {
      setModels(await loadChatGptModels());
      state = await loadChatGptConnection();
    }
    setConnection(state);
    return state;
  }, []);

  useEffect(() => {
    if (window.location.hostname !== "127.0.0.1") return;
    setIsLocal(true);
    const query = new URLSearchParams(window.location.search);
    const connected = query.get("chatgpt") === "connected";
    if (query.get("chatgpt") === "failed")
      setError(chatGptSignInErrorMessage(query.get("chatgpt_error")));
    if (query.has("chatgpt")) {
      query.delete("chatgpt");
      query.delete("chatgpt_error");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query.size ? `?${query}` : ""}`,
      );
    }
    void reload()
      .then((state) => {
        if (connected && state?.sharing && state.selectedId) {
          const key = `mergeone-chatgpt-welcome-${state.selectedId}`;
          try {
            if (!window.localStorage.getItem(key)) {
              setWelcome(true);
              window.localStorage.setItem(key, "shown");
            }
          } catch {
            setWelcome(true);
          }
        }
      })
      .catch(() =>
        setError(
          "Impossible de charger la connexion ChatGPT. Réessayez dans quelques instants.",
        ),
      )
      .finally(() => setLoaded(true));
  }, [reload]);

  async function run(effect: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await effect();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "La demande ChatGPT a échoué.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!connection) {
    if (!isLocal) return null;
    return (
      <PageSection title="Mon forfait ChatGPT">
        {error ? (
          <div className="space-y-3">
            <Alert variant="danger">{error}</Alert>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void run(reload)}
            >
              Réessayer la connexion
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {loaded
              ? "Connexion ChatGPT indisponible sur cette instance."
              : "Chargement de la connexion…"}
          </p>
        )}
      </PageSection>
    );
  }

  const selected = connection.profiles.find(
    (profile) => profile.id === connection.selectedId,
  );
  const selectedModel = models.find((model) => model.id === connection.model);
  const hasCurrentEffortOption =
    !connection.reasoningEffort ||
    selectedModel?.reasoningEfforts.includes(connection.reasoningEffort);
  const connectionInfo = (
    <InfoPopover
      label="À propos du forfait ChatGPT"
      title="Forfait ChatGPT dans MergeOne"
    >
      <p>
        Le forfait Plus ou Pro peut servir au classement des documents, au
        brief, aux ouvrages, à la structure, aux explications et au métré sur ce
        Mac.
      </p>
      <p>
        Les demandes consomment les limites de votre forfait. MergeOne n’accède
        pas à vos conversations ChatGPT. La connexion est propre à votre compte
        et à l’organisation active.
      </p>
      <p>
        Les documents nécessaires sont transmis à OpenAI, selon les formats
        acceptés par le modèle. Pour un métré, le compte, le modèle et l’effort
        sont ceux du créateur ; gardez MergeOne ouvert sur ce Mac pendant
        l’analyse.
      </p>
    </InfoPopover>
  );

  return (
    <PageSection title="Mon forfait ChatGPT" actions={connectionInfo}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Compte actif</p>
          <p className="mt-1 break-all text-sm font-medium text-foreground">
            {selected?.email || selected?.label || "Aucun compte connecté"}
          </p>
        </div>
        <Badge
          variant={connection.sharing ? "success" : "warning"}
          dot
          role="status"
        >
          {connection.sharing
            ? "Forfait activé"
            : selected?.connected
              ? "À autoriser"
              : "Déconnecté"}
        </Badge>
      </div>

      {welcome && connection.sharing ? (
        <Alert variant="success" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>Votre forfait ChatGPT est activé.</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWelcome(false)}
            >
              Compris
            </Button>
          </div>
        </Alert>
      ) : null}

      {connection.sharing ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-model`}>Modèle ChatGPT</FieldLabel>
              <InfoPopover
                label="À propos du modèle ChatGPT"
                title="Modèle ChatGPT"
              >
                <p>
                  Cette liste contient les modèles accessibles avec le compte
                  sélectionné. Le choix s’applique aux prochaines demandes.
                  Changer de compte, de modèle ou d’effort pendant un métré peut
                  interrompre son traitement.
                </p>
                <p>
                  Lors d’un changement de modèle, un effort non proposé par ce
                  modèle revient sur Automatique. La confirmation est affichée
                  après l’enregistrement.
                </p>
              </InfoPopover>
            </div>
            <NativeSelect
              id={`${id}-model`}
              disabled={busy || models.length === 0}
              value={connection.model ?? ""}
              onChange={(event) => {
                const model = models.find(
                  (item) => item.id === event.target.value,
                );
                if (!model) return;
                const reasoningEffort =
                  connection.reasoningEffort &&
                  model.reasoningEfforts.includes(connection.reasoningEffort)
                    ? connection.reasoningEffort
                    : null;
                void run(async () => {
                  await chooseChatGptPreferences({
                    model: model.id,
                    reasoningEffort,
                  });
                  await reload();
                  setMessage(
                    connection.reasoningEffort && !reasoningEffort
                      ? "Modèle enregistré. L’effort est revenu sur Automatique car le niveau précédent n’est pas proposé pour ce modèle."
                      : "Préférences ChatGPT enregistrées.",
                  );
                });
              }}
            >
              <option value="" disabled>
                Choisir un modèle
              </option>
              {connection.model && !selectedModel ? (
                <option value={connection.model}>
                  {connection.model} · sélection actuelle
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.id === "gpt-6.1-terra" ? " · par défaut" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${id}-effort`}>
                Effort de raisonnement
              </FieldLabel>
              <InfoPopover
                label="À propos de l’effort de raisonnement"
                title="Effort de raisonnement"
              >
                <p>
                  Un effort plus élevé peut aider sur les réponses complexes,
                  avec davantage de temps et de consommation.
                </p>
                <p>
                  Automatique reprend le réglage du modèle. Seuls les niveaux
                  proposés pour le modèle sélectionné sont disponibles. Changer
                  l’effort pendant un métré peut interrompre son traitement.
                </p>
              </InfoPopover>
            </div>
            <NativeSelect
              id={`${id}-effort`}
              disabled={busy || !selectedModel}
              value={connection.reasoningEffort ?? "auto"}
              onChange={(event) => {
                if (!selectedModel) return;
                const reasoningEffort =
                  selectedModel.reasoningEfforts.find(
                    (effort) => effort === event.target.value,
                  ) ?? null;
                void run(async () => {
                  await chooseChatGptPreferences({
                    model: selectedModel.id,
                    reasoningEffort,
                  });
                  await reload();
                  setMessage("Préférences ChatGPT enregistrées.");
                });
              }}
            >
              <option value="auto">Automatique</option>
              {!hasCurrentEffortOption && connection.reasoningEffort ? (
                <option value={connection.reasoningEffort}>
                  {effortLabels[connection.reasoningEffort]} · sélection
                  actuelle
                </option>
              ) : null}
              {selectedModel?.reasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effortLabels[effort]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {selected?.connected ? (
            <p className="text-sm text-muted-foreground">
              Autorisez l’utilisation du forfait pour activer ChatGPT.
            </p>
          ) : null}
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await connectChatGpt(selected?.id);
                window.location.assign(result.url);
              })
            }
          >
            {selected ? "Reconnecter ChatGPT" : "Continue with ChatGPT"}
          </Button>
        </div>
      )}

      {error ? (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="info" className="mt-4">
          {message}
        </Alert>
      ) : null}

      <details className="group mt-5 border-t border-border-subtle pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>Gestion des comptes</span>
          <ChevronDownIcon
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-4 pt-3">
          {connection.profiles.length > 0 ? (
            <div className="space-y-2">
              <FieldLabel htmlFor={`${id}-account`}>Compte ChatGPT</FieldLabel>
              <NativeSelect
                id={`${id}-account`}
                disabled={busy}
                value={connection.selectedId ?? ""}
                onChange={(event) =>
                  void run(async () => {
                    await chooseChatGptAccount(event.target.value);
                    await reload();
                  })
                }
              >
                <option value="" disabled>
                  Choisir une connexion
                </option>
                {connection.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label} ·{" "}
                    {profile.email || "Inscription à reprendre"}
                    {profile.connected ? "" : " · déconnectée"}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {connection.sharing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !connection.model}
                  onClick={() =>
                    void run(async () => {
                      const result = await testChatGptConnection();
                      if (result.success)
                        setMessage(
                          `Connexion vérifiée avec ${result.model}. Cette vérification a utilisé votre forfait.`,
                        );
                    })
                  }
                >
                  Tester la connexion
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(reload)}
                >
                  Actualiser les modèles
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Le test de connexion utilise votre forfait.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {connection.sharing ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await connectChatGpt(selected?.id);
                    window.location.assign(result.url);
                  })
                }
              >
                Reconnecter ChatGPT
              </Button>
            ) : null}
            {connection.profiles.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await connectChatGpt();
                    window.location.assign(result.url);
                  })
                }
              >
                Ajouter un compte
              </Button>
            ) : null}
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await disconnectChatGpt();
                    await reload();
                    setWelcome(false);
                    setMessage(
                      result.revocationConfirmed
                        ? "ChatGPT déconnecté. Les fonctions IA reprennent leur configuration habituelle."
                        : "Connexion supprimée de ce Mac. La révocation distante n’a pas pu être confirmée : déconnectez aussi MergeOne dans les paramètres de sécurité ChatGPT.",
                    );
                  })
                }
              >
                Déconnecter ChatGPT
              </Button>
            ) : null}
          </div>
          <a
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Gérer ma consommation
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </details>
    </PageSection>
  );
}
