"use client";

import { useEffect, useId, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

import { aiAccessApi, aiAccessErrorMessage, formatAccessDate } from "@/components/ai/ai-access-api";
import { currentPageUrl, isLoopbackPage } from "@/components/ai/page-address";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ApiKeyAccessState, ApiKeyOfferedModel } from "@/lib/ai/access/contracts";
import { apiKeyErrorMessage } from "@/lib/ai/access/api-key-errors";
import { boundModelTest, formatUsd, formatUsdCeiling } from "@/lib/ai/access/openai-pricing";

// « Clé API » in « Mon profil › Accès IA ». The key is typed in a masked field,
// sent once to the local server, and the field is emptied: the page then knows
// only the provider, the masked suffix, the place, the dates and the models the
// key last listed (drawing the page opens neither the Keychain nor a call
// to OpenAI). Nothing here shows or copies a saved key. The field exists only
// on the loopback address: from another host the key would cross the network
// in clear. The key can be selected for photo analysis and takeoff lab runs.

const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";
const OPENAI_USAGE_URL = "https://platform.openai.com/usage";

const linkClass = "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function testAnnouncement(model: string) {
  const bound = boundModelTest(model);
  return bound.status === "priced"
    ? `Le test envoie un petit appel facturable sur votre compte API OpenAI, au plus ${formatUsdCeiling(bound.nanoUsd)}, sans aucun document client.`
    : "Le tarif de ce modèle n’est pas connu : le test n’est pas proposé.";
}

function ModelSelect({ id, models, value, onChange, disabled }: {
  id: string; models: ApiKeyOfferedModel[]; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  return (
    <NativeSelect id={id} value={value} disabled={disabled || models.length === 0} onChange={(event) => onChange(event.target.value)}>
      {models.length === 0 ? <option value="">Aucun modèle proposé</option> : null}
      {models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.verified ? "" : " · non vérifié"}</option>)}
    </NativeSelect>
  );
}

export function ApiKeyAccessEntry({ state: managedState, onStateChange }: Readonly<{
  state?: ApiKeyAccessState | null;
  onStateChange?: (state: ApiKeyAccessState) => void;
}> = {}) {
  const id = useId();
  // A hosted build has no Keychain: no request, the entry says where the key works. Inlined at build time, so the
  // server and the browser draw the same thing.
  const hosted = process.env.NODE_ENV === "production";
  /** The page's own address, read once mounted: the field is offered on the loopback address only. */
  const [loopback, setLoopback] = useState<{ allowed: boolean; profileUrl: string } | null>(null);
  const [localState, setLocalState] = useState<ApiKeyAccessState | null>(null);
  const state = managedState === undefined ? localState : managedState;
  const setState = onStateChange ?? setLocalState;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** A key that may not list models: its explicit model test before saving. */
  const [needsTest, setNeedsTest] = useState<ApiKeyOfferedModel[] | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; revoke?: boolean } | null>(null);

  useEffect(() => {
    if (hosted) return;
    const page = currentPageUrl();
    setLoopback({ allowed: isLoopbackPage(page), profileUrl: `http://127.0.0.1${page.port ? `:${page.port}` : ""}/dashboard/profile` });
    void aiAccessApi.state().then(setState).catch((cause: unknown) => setLoadError(aiAccessErrorMessage(cause)));
  }, [hosted, setState]);

  // The last catalog check is read from local metadata.
  const models = state?.status === "saved" ? state.connection.offeredModels : [];
  const savedModel = models.find((entry) => entry.id === model) ?? models[0];
  const selectedModel = savedModel?.id ?? "";

  async function run(effect: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await effect();
    } catch (cause) {
      setError(aiAccessErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function save(candidateModel: string | null) {
    void run(async () => {
      const result = await aiAccessApi.save(candidate, candidateModel);
      if (result.outcome === "needs_model_test") {
        setNeedsTest(result.models);
        setModel(result.models[0]?.id ?? "");
        return;
      }
      setCandidate("");
      setNeedsTest(null);
      setReplacing(false);
      setState(result.state);
      setMessage({ text: candidateModel
        ? `Clé enregistrée : le modèle a répondu. Coût estimé du test : ${formatUsd(result.testCostNanoUsd)}.`
        : "Clé reconnue par OpenAI et enregistrée dans le Trousseau de ce Mac." });
    });
  }

  const help = (
    <InfoPopover label="À propos de la clé API" title="Clé API dans MergeOne">
      <p>La clé est conservée dans le Trousseau macOS de ce Mac, pour votre compte dans cette entreprise. Elle ne quitte ce Mac que vers OpenAI.</p>
      <p>La source et le modèle de vos analyses se choisissent dans les réglages IA.</p>
      <p>MergeOne n’utilise jamais la clé à la place d’un abonnement expiré, ni l’abonnement à la place d’une clé refusée.</p>
    </InfoPopover>
  );
  const title = "Clé API";

  const unavailable = hosted ? apiKeyErrorMessage("AI_KEY_KEYCHAIN_UNAVAILABLE") : state?.status === "unavailable" ? state.message : null;
  if (unavailable !== null) {
    return (
      <PageSection variant="plain" headingLevel={3} title={title} actions={<Badge variant="neutral" size="sm">Mac uniquement</Badge>}>
        <p className="text-sm text-muted-foreground">{unavailable}</p>
      </PageSection>
    );
  }
  if (!state) {
    return (
      <PageSection variant="plain" headingLevel={3} title={title}>
        {loadError ? <Alert variant="danger">{loadError}</Alert>
          : <p role="status" className="text-sm text-muted-foreground">Chargement de la clé API…</p>}
      </PageSection>
    );
  }
  const saved = state.status === "saved" ? state.connection : null;
  const keyEntryAllowed = loopback?.allowed === true;
  const showForm = keyEntryAllowed && (!saved || replacing);
  const badge = saved
    ? <Badge variant="success" dot role="status">{saved.verification === "models_listed" ? "Clé reconnue" : "Modèle testé"}</Badge>
    : <Badge variant="neutral" dot role="status">Aucune clé</Badge>;

  return (
    <PageSection variant="plain" headingLevel={3} title={title} actions={<>{badge}{help}</>}>
      <p className="text-sm text-muted-foreground">La clé API peut servir aux analyses photo et au labo métré.</p>
      {state.status === "empty" && state.notice ? <Alert variant="warning" className="mt-4">{state.notice}</Alert> : null}

      {saved ? (
        <div className="mt-4 space-y-3">
          <p className="break-all font-mono text-sm font-medium text-foreground">OpenAI · •••• {saved.suffix} · {saved.placeLabel}</p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Dernier test</dt>
              <dd className="mt-0.5 text-foreground">{saved.lastTest ? `Modèle testé le ${formatAccessDate(saved.lastTest.at)} · ${saved.lastTest.model}` : "Aucun test"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Dernière utilisation dans MergeOne</dt>
              <dd className="mt-0.5 text-foreground">{saved.lastUsedAt ? formatAccessDate(saved.lastUsedAt) : "Jamais"}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {loopback && !keyEntryAllowed ? (
        <Alert variant="info" className="mt-4">
          <div className="space-y-1">
            <p>{apiKeyErrorMessage("AI_KEY_LOOPBACK_ONLY")}</p>
            <a href={loopback.profileUrl} className={linkClass}>{loopback.profileUrl}</a>
          </div>
        </Alert>
      ) : null}

      {showForm ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${id}-key`}>Clé API OpenAI</FieldLabel>
            <Input id={`${id}-key`} type="password" name="openai-api-key" autoComplete="off" spellCheck={false} placeholder="sk-…"
              value={candidate} disabled={busy} aria-describedby={`${id}-key-billing`}
              onChange={(event) => { setCandidate(event.target.value); setNeedsTest(null); }} />
            <p id={`${id}-key-billing`} className="text-xs text-muted-foreground">
              Les analyses lancées avec cette clé seront facturées sur votre compte API OpenAI. Créez de préférence une clé de projet dédiée à MergeOne.
              {replacing ? " La clé actuelle reste en service tant que la nouvelle n’est pas vérifiée." : ""}
            </p>
          </div>
          {needsTest ? (
            <div className="space-y-2 rounded-md border border-border-subtle bg-surface-subtle p-3">
              <p className="text-sm text-foreground">
                OpenAI n’a pas autorisé la liste des modèles avec cette clé : elle est peut-être restreinte, ou invalide. Le test annoncé ci-dessous le dira.
              </p>
              <FieldLabel htmlFor={`${id}-candidate-model`}>Modèle à tester</FieldLabel>
              <ModelSelect id={`${id}-candidate-model`} models={needsTest} value={model} onChange={setModel} disabled={busy} />
              {model ? <p className="text-xs text-muted-foreground">{testAnnouncement(model)}</p> : null}
              <Button type="button" disabled={busy || !candidate.trim() || !model} onClick={() => save(model)}>Tester le modèle et enregistrer</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !candidate.trim()} loading={busy} onClick={() => save(null)}>Vérifier et enregistrer</Button>
              {replacing ? <Button type="button" variant="ghost" disabled={busy} onClick={() => { setReplacing(false); setCandidate(""); }}>Annuler</Button> : null}
            </div>
          )}
        </div>
      ) : null}

      {saved && !replacing ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-1.5">
              <FieldLabel htmlFor={`${id}-model`}>Modèle à tester</FieldLabel>
              <ModelSelect id={`${id}-model`} models={models} value={selectedModel} onChange={setModel} disabled={busy} />
            </div>
            <Button type="button" variant="outline" disabled={busy || !selectedModel} onClick={() => void run(async () => {
              const result = await aiAccessApi.test(selectedModel);
              setState(result.state);
              setMessage({ text: `Modèle testé le ${formatAccessDate(result.at)} : ${result.model} a répondu. Coût estimé : ${formatUsd(result.costNanoUsd)}.` });
            })}>Tester le modèle</Button>
          </div>
          {selectedModel ? <p className="text-xs text-muted-foreground">{testAnnouncement(selectedModel)}</p> : null}
          {confirmRemove ? (
            <Alert variant="warning">
              <div className="space-y-2">
                <p>Retirer la clé de MergeOne ? Aucun nouvel appel ne l’utilisera. Elle restera valable chez OpenAI tant que vous ne l’y révoquez pas.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="danger" disabled={busy} onClick={() => void run(async () => {
                    setState(await aiAccessApi.remove());
                    setConfirmRemove(false);
                    setMessage({ text: "Clé retirée de MergeOne. Révoquez-la aussi dans votre compte OpenAI : un appel déjà envoyé peut encore être facturé.", revoke: true });
                  })}>Retirer la clé</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Annuler</Button>
                </div>
              </div>
            </Alert>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {
                setState(await aiAccessApi.refreshModels());
                setMessage({ text: "Liste des modèles actualisée." });
              })}>Actualiser les modèles</Button>
              {keyEntryAllowed ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setReplacing(true); setMessage(null); setError(null); }}>Remplacer</Button>
              ) : null}
              <Button type="button" variant="ghost" className="text-danger hover:text-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Retirer</Button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <Alert variant="danger" className="mt-4">{error}</Alert> : null}
      {message ? (
        <Alert variant="info" className="mt-4">
          <div className="space-y-1">
            <p>{message.text}</p>
            {message.revoke ? (
              <a href={OPENAI_KEYS_URL} target="_blank" rel="noreferrer" className={linkClass}>
                Révoquer la clé chez OpenAI
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {saved ? (
        <a href={OPENAI_USAGE_URL} target="_blank" rel="noreferrer" className={`${linkClass} mt-2`}>
          Consulter ma consommation OpenAI
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </PageSection>
  );
}
