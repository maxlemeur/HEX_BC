"use client";

import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

/** A pair the operator may confirm, with what tells homonyms apart (section, source, position) on both sides. */
type Continuity = {
  previousItemId: string; nextItemId: string; previousLabel: string; nextLabel: string; previousFacts: string;
  nextFacts: string; ambiguous: boolean;
};

function pairingText({ previousLabel, previousFacts, nextLabel, nextFacts, ambiguous }: Continuity) {
  const side = (label: string, facts: string) => `« ${label} »${facts ? ` (${facts})` : ""}`;
  return `${side(previousLabel, previousFacts)} devient ${side(nextLabel, nextFacts)}`
    + (ambiguous ? " (plusieurs rapprochements possibles)" : "");
}

/**
 * The server's answer to a gesture: none when it recorded it, its refusal (`refused`, the gesture is decided), or no
 * answer at all (`unanswered`: a network failure, the gesture may have been recorded; sent again with the same key, it
 * is replayed, never recorded twice).
 */
type PostFailure = { kind: "refused" | "unanswered"; message: string };

async function post(url: string, body: unknown, unanswered: string): Promise<PostFailure | null> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "unanswered", message: unanswered };
  }
  if (response.ok) return null;
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return { kind: "refused", message: payload?.error?.message ?? "La liste des postes n’a pas pu être enregistrée." };
}

/** A new list revision updates both the open item table and the server-rendered list panel. */
function useRefreshItemList(projectId: string) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  return async () => {
    await mutate(key => Array.isArray(key) && key[2] === projectId
      && (key[0] === "item-table" || key[0] === "unlisted-finds"));
    router.refresh();
  };
}

/**
 * Accept the revision the sources propose, as shown: the server recomputes it and refuses one that changed. A
 * continuity is never preselected: each is a choice of the operator.
 */
export function TakeoffItemListProposalForm({ projectId, expectedRevision, digest, cause, continuities }: {
  projectId: string; expectedRevision: number; digest: string; cause: "initial" | "proposal"; continuities: Continuity[];
}) {
  const refreshList = useRefreshItemList(projectId);
  const intent = useRef<string>(crypto.randomUUID());
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const key = (continuity: Continuity) => `${continuity.previousItemId}:${continuity.nextItemId}`;
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const failure = await post(`/api/affaires/${projectId}/takeoff/item-list/revisions`, {
        expected_revision: expectedRevision, proposal_digest: digest, intent_key: intent.current,
        continuities: continuities.filter((continuity) => accepted.has(key(continuity)))
          .map(({ previousItemId, nextItemId }) => ({ previous_item_id: previousItemId, next_item_id: nextItemId })),
      }, "La réponse du serveur n’est pas arrivée. Vérifiez votre connexion puis réessayez : la révision ne sera pas "
        + "enregistrée deux fois.");
      if (failure) {
        setError(failure.message);
        // A refusal decides the gesture: the next click is another one. Without an answer, the same gesture is sent again.
        if (failure.kind === "refused") intent.current = crypto.randomUUID();
        return;
      }
      await refreshList();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {continuities.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Même poste ? Cochez les rapprochements que vous confirmez.</legend>
          {continuities.map((continuity) => (
            <label key={key(continuity)} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={accepted.has(key(continuity))}
                onChange={(event) => setAccepted((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(key(continuity)); else next.delete(key(continuity));
                  return next;
                })}
              />
              <span>{pairingText(continuity)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="button" onClick={submit} disabled={pending}>
        {cause === "initial" ? "Enregistrer la liste proposée" : "Accepter la révision proposée"}
      </Button>
    </div>
  );
}

/** Add an item by hand: a designation, its unit or « à préciser », its section; no quantity or price is asked. */
export function TakeoffItemListAddForm({ projectId, expectedRevision, sections }: {
  projectId: string; expectedRevision: number; sections: Array<{ itemId: string; label: string }>;
}) {
  const refreshList = useRefreshItemList(projectId);
  const id = useId();
  const intent = useRef<string>(crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const failure = await post(`/api/affaires/${projectId}/takeoff/item-list/items`, {
        expected_revision: expectedRevision, intent_key: intent.current, label: text("label"),
        expected_unit: text("unit") || null, measurement_basis: text("basis") || null,
        qualifiers: Object.fromEntries(["network", "material", "diameter"].flatMap((name) => text(name) ? [[name, text(name)]] : [])),
        section_of_item_id: text("section") || null,
      }, "La réponse du serveur n’est pas arrivée. Vérifiez votre connexion puis réessayez : le poste ne sera pas ajouté "
        + "deux fois.");
      // What was typed stays, and the same gesture is sent again by the next click.
      if (failure) {
        setError(failure.message);
        return;
      }
      intent.current = crypto.randomUUID();
      form.reset();
      await refreshList();
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label="Ajouter un poste"
      onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-label`}>Désignation</Label>
        <Input id={`${id}-label`} name="label" required maxLength={300} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-unit`}>Unité (vide : à préciser)</Label>
        <Input id={`${id}-unit`} name="unit" maxLength={16} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-section`}>Section</Label>
        <NativeSelect id={`${id}-section`} name="section" defaultValue="">
          <option value="">Postes ajoutés</option>
          {sections.map(({ itemId, label }) => <option key={itemId} value={itemId}>{label}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-basis`}>Base de mesure</Label>
        <Input id={`${id}-basis`} name="basis" maxLength={300} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-network`}>Réseau</Label>
        <Input id={`${id}-network`} name="network" maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-material`}>Matière</Label>
        <Input id={`${id}-material`} name="material" maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-diameter`}>Diamètre</Label>
        <Input id={`${id}-diameter`} name="diameter" maxLength={120} />
      </div>
      {error && <Alert variant="danger" className="sm:col-span-2"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>Ajouter le poste</Button>
      </div>
    </form>
  );
}
