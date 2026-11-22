"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  diffItemTemplateDefinitions,
  itemTemplateDefinitionSchema,
  type ItemTemplateDefinition,
  type ItemTemplateLine,
} from "@/lib/takeoff/item-template";

type Props = {
  templateKey: string;
  /** usedLineIds: every identifier the template ever used, which a new line never takes. */
  published: { version: number; definition: ItemTemplateDefinition; publishedAt: string | null; usedLineIds: string[] };
  draft: { revision: number; token: string; definition: ItemTemplateDefinition } | null;
};

function slug(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 56) || "poste";
}

function freshId(base: string, taken: Set<string>) {
  let id = slug(base);
  for (let n = 2; taken.has(id); n += 1) id = `${slug(base)}-${n}`;
  return id;
}

async function send(method: string, url: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { data?: { revision?: number; token?: string; version?: number };
    error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "Le gabarit n’a pas pu être enregistré.");
  return payload?.data ?? {};
}

/**
 * The template an administrator corrects: every line keeps its identifier (an item made from it keeps its identity in
 * every affaire), a new line gets a new one. The draft is saved on the version it started from; publishing it shows
 * first what it adds, removes and changes.
 */
export function ItemTemplateEditor({ templateKey, published, draft }: Props) {
  const router = useRouter();
  const [definition, setDefinition] = useState<ItemTemplateDefinition>(draft?.definition ?? published.definition);
  const [revision, setRevision] = useState(draft?.revision ?? 0);
  const [token, setToken] = useState<string | null>(draft?.token ?? null);
  const [saved, setSaved] = useState(JSON.stringify(draft?.definition ?? published.definition));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const intent = useRef<string>(crypto.randomUUID());
  const dirty = JSON.stringify(definition) !== saved;
  const diff = useMemo(() => diffItemTemplateDefinitions(published.definition, definition), [definition, published.definition]);
  const validation = itemTemplateDefinitionSchema.safeParse(definition);
  const base = `/api/takeoff/item-templates/${templateKey}`;

  const updateLine = (familyIndex: number, lineIndex: number, change: Partial<ItemTemplateLine>) =>
    setDefinition((current) => ({ ...current, families: current.families.map((family, index) => index !== familyIndex ? family
      : { ...family, lines: family.lines.map((line, position) => position === lineIndex ? { ...line, ...change } : line) }) }));
  const removeLine = (familyIndex: number, lineIndex: number) =>
    setDefinition((current) => ({ ...current, families: current.families.map((family, index) => index !== familyIndex ? family
      : { ...family, lines: family.lines.filter((_, position) => position !== lineIndex) }) }));
  const addLine = (familyIndex: number, label: string) => setDefinition((current) => {
    // Never an identifier the template ever used: an item made from a retired line would follow it.
    const taken = new Set([...published.usedLineIds, ...current.families.flatMap((family) => family.lines.map(({ id }) => id))]);
    const line: ItemTemplateLine = { id: freshId(label, taken), label, expectedUnit: null, measurementBasis: null,
      qualifiers: {}, synonyms: [] };
    return { ...current, families: current.families.map((family, index) => index !== familyIndex ? family
      : { ...family, lines: [...family.lines, line] }) };
  });
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Le gabarit n’a pas pu être enregistré.");
    } finally {
      setPending(false);
    }
  };
  const save = () => run(async () => {
    const result = await send("PUT", `${base}/draft`, { expected_token: token, base_version: published.version, definition });
    setRevision(result.revision ?? revision + 1);
    setToken(result.token ?? null);
    setSaved(JSON.stringify(definition));
  });
  const publish = () => run(async () => {
    await send("POST", `${base}/publish`, { expected_token: token, intent_key: intent.current });
    intent.current = crypto.randomUUID();
    router.refresh();
  });
  const discard = () => run(async () => {
    await send("DELETE", `${base}/draft`, { expected_token: token });
    // The draft is gone: the editor starts again from the published version, as a reload would show it (the page keeps
    // the same key when the draft discarded was saved here: it was not there when the page was read).
    setDefinition(published.definition);
    setSaved(JSON.stringify(published.definition));
    setRevision(0);
    setToken(null);
    intent.current = crypto.randomUUID();
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <p className="text-sm">
        Version publiée : {published.version}{published.publishedAt ? "" : " (livrée avec l’application)"}.{" "}
        {revision > 0 ? `Brouillon enregistré (révision ${revision}).` : "Aucun brouillon enregistré."}
      </p>
      {definition.families.map((family, familyIndex) => (
        <fieldset key={family.id} className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{family.title}</legend>
          {family.lines.map((line, lineIndex) => (
            <div key={line.id} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]" role="group" aria-label={`Poste ${line.id}`}>
              <Input aria-label={`Désignation du poste ${line.id}`} value={line.label}
                onChange={(event) => updateLine(familyIndex, lineIndex, { label: event.target.value })} />
              <Input aria-label={`Unité du poste ${line.id}`} value={line.expectedUnit ?? ""}
                onChange={(event) => updateLine(familyIndex, lineIndex, { expectedUnit: event.target.value || null })} />
              <Input aria-label={`Base de mesure du poste ${line.id}`} value={line.measurementBasis ?? ""}
                onChange={(event) => updateLine(familyIndex, lineIndex, { measurementBasis: event.target.value || null })} />
              <Button type="button" variant="danger" size="sm" onClick={() => removeLine(familyIndex, lineIndex)}>
                Retirer le poste {line.id}
              </Button>
            </div>
          ))}
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("label") as HTMLInputElement;
            if (input.value.trim()) addLine(familyIndex, input.value.trim());
            input.value = "";
          }}>
            <Input name="label" aria-label={`Nouveau poste de ${family.title}`} placeholder="Désignation du nouveau poste" />
            <Button type="submit" variant="outline" size="sm">Ajouter à {family.title}</Button>
          </form>
        </fieldset>
      ))}
      <section aria-label="Aperçu de la publication" className="space-y-2 rounded-md border p-3 text-sm">
        <p className="font-medium">
          Par rapport à la version {published.version} : {diff.added.length} ajouté{diff.added.length > 1 ? "s" : ""},{" "}
          {diff.removed.length} retiré{diff.removed.length > 1 ? "s" : ""}, {diff.changed.length} modifié
          {diff.changed.length > 1 ? "s" : ""}
        </p>
        <ul className="list-disc space-y-1 pl-6">
          {diff.added.map(({ line }) => <li key={`a-${line.id}`}>Ajouté : {line.label}</li>)}
          {diff.removed.map(({ line }) => <li key={`r-${line.id}`}>Retiré : {line.label}</li>)}
          {diff.changed.map(({ before, after }) => (
            <li key={`c-${after.id}`}>Modifié : {before.label === after.label ? after.label : `${before.label} → ${after.label}`}</li>
          ))}
        </ul>
      </section>
      {!validation.success && (
        <Alert variant="warning"><AlertDescription>{validation.error.issues[0]?.message}</AlertDescription></Alert>
      )}
      {error && <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} disabled={pending || !dirty || !validation.success}>Enregistrer le brouillon</Button>
        <Button type="button" variant="secondary" onClick={publish} disabled={pending || dirty || revision === 0}>
          Publier la version {published.version + 1}
        </Button>
        {revision > 0 && (
          <Button type="button" variant="ghost" onClick={discard} disabled={pending}>Abandonner le brouillon</Button>
        )}
      </div>
    </div>
  );
}
