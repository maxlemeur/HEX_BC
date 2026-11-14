"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Link2, PackagePlus, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { effectiveLineMaterial } from "@/lib/material-requests/alerts";
import {
  fetchMaterialRequestLineCandidates,
  fetchSupplyTypes,
  materialRequestErrorMessage,
  type MaterialRequestSupplyType,
} from "@/lib/material-requests/client";
import type {
  CreateMaterialRequestLineArticleInput,
  MaterialRequest,
  MaterialRequestArticleCandidate,
  MaterialRequestLine,
} from "@/lib/material-requests/contracts";

import {
  ArticleIdentity,
  articleLinkHold,
  CandidateReasons,
  LearnAliasChoice,
  learnableWords,
  REOPENS_ON_LINK,
} from "./MaterialRequestArticleCell";
import { lineTitle } from "./format";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";

type Search =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "ready"; q: string; candidates: MaterialRequestArticleCandidate[] }
  | { status: "error"; q: string; message: string };

function CandidateItem({
  candidate,
  hold,
  onLink,
}: Readonly<{
  candidate: MaterialRequestArticleCandidate;
  hold: string | null;
  onLink: () => Promise<void>;
}>) {
  const warningsId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <ArticleIdentity article={candidate.article} />
      <CandidateReasons candidate={candidate} warningsId={warningsId} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        loading={busy}
        disabled={hold !== null}
        aria-label={`Rattacher « ${candidate.article.designation} »`}
        aria-describedby={candidate.warnings.length > 0 ? warningsId : undefined}
        onClick={async () => {
          setBusy(true);
          await onLink();
          setBusy(false);
        }}
      >
        <Link2 aria-hidden="true" />
        Rattacher
      </Button>
    </li>
  );
}

type CreationFields = {
  product_type: string;
  material: string;
  dimensions: string;
  unit: string;
  supply_type_id: string;
  designation: string;
  reference: string;
};

type SupplyTypes =
  | { status: "loading" }
  | { status: "ready"; items: MaterialRequestSupplyType[] }
  | { status: "error"; message: string };

/**
 * The article a line names, created as a draft of the catalogue and linked at once. Prefilled from the
 * line; the supply type is the operator's choice. A refusal keeps what was typed.
 */
function ArticleCreationForm({
  line,
  request,
  hold,
  onCreate,
  onBack,
}: Readonly<{
  line: MaterialRequestLine;
  request: MaterialRequest;
  hold: string | null;
  onCreate: (input: CreateMaterialRequestLineArticleInput) => Promise<SaveResult>;
  onBack: () => void;
}>) {
  const ids = useId();
  const [fields, setFields] = useState<CreationFields>(() => ({
    product_type: line.product_type ?? "",
    material: effectiveLineMaterial(line, request).material ?? "",
    dimensions: line.dimension ?? "",
    unit: line.unit ?? "",
    supply_type_id: "",
    designation: "",
    reference: "",
  }));
  const [supplyTypes, setSupplyTypes] = useState<SupplyTypes>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [learn, setLearn] = useState(false);
  // The technician's words, unless the article created says them already.
  const learnable = learnableWords(line.product_type, { product_type: fields.product_type, designation: fields.designation });

  useEffect(() => {
    const abort = new AbortController();
    fetchSupplyTypes(abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setSupplyTypes({ status: "ready", items });
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) {
          setSupplyTypes({
            status: "error",
            message: materialRequestErrorMessage(failure, "Les types de fourniture n’ont pas pu être chargés."),
          });
        }
      });
    return () => abort.abort();
  }, []);

  const set = (key: keyof CreationFields) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    setFields((current) => ({ ...current, [key]: value }));
  };
  const none = supplyTypes.status === "ready" && supplyTypes.items.length === 0;
  const id = (name: string) => `${ids}-${name}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = (key: keyof CreationFields) => fields[key].trim();
    if (!value("product_type") || !value("material") || !value("unit") || !fields.supply_type_id) {
      setError("Renseignez le type d’article, la matière, l’unité et le type de fourniture.");
      return;
    }
    const input: CreateMaterialRequestLineArticleInput = {
      product_type: value("product_type"),
      material: value("material"),
      unit: value("unit"),
      supply_type_id: fields.supply_type_id,
      ...(value("dimensions") ? { dimensions: value("dimensions") } : {}),
      ...(value("designation") ? { designation: value("designation") } : {}),
      ...(value("reference") ? { reference: value("reference") } : {}),
      ...(learn && learnable ? { learn_alias: true } : {}),
    };
    setBusy(true);
    const result = await onCreate(input);
    setBusy(false);
    setError(result.ok ? null : result.message);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" aria-labelledby={id("title")}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={id("title")} className="text-sm font-semibold text-foreground">
          Créer l’article
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Propositions
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        L’article arrive en brouillon dans le catalogue, marqué « Nouveau » jusqu’à sa validation. * obligatoire.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={id("type")}>Type d’article *</FieldLabel>
          <Input id={id("type")} size="sm" autoComplete="off" maxLength={200} required value={fields.product_type} onChange={set("product_type")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={id("material")}>Matière *</FieldLabel>
          <Input id={id("material")} size="sm" autoComplete="off" maxLength={120} required value={fields.material} onChange={set("material")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={id("dimensions")}>Dimension</FieldLabel>
          <Input id={id("dimensions")} size="sm" autoComplete="off" maxLength={120} value={fields.dimensions} onChange={set("dimensions")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={id("unit")}>Unité *</FieldLabel>
          <Input id={id("unit")} size="sm" autoComplete="off" maxLength={20} required value={fields.unit} onChange={set("unit")} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <FieldLabel htmlFor={id("supply")}>Type de fourniture *</FieldLabel>
          <NativeSelect
            id={id("supply")}
            size="sm"
            required
            disabled={supplyTypes.status !== "ready" || none}
            aria-describedby={supplyTypes.status === "ready" && !none ? undefined : id("supply-state")}
            value={fields.supply_type_id}
            onChange={set("supply_type_id")}
          >
            <option value="">Choisir…</option>
            {supplyTypes.status === "ready"
              ? supplyTypes.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))
              : null}
          </NativeSelect>
          <div id={id("supply-state")} className="text-xs">
            {supplyTypes.status === "loading" ? <p className="text-muted-foreground">Chargement des types de fourniture…</p> : null}
            {supplyTypes.status === "error" ? <p className="text-danger">{supplyTypes.message}</p> : null}
            {none ? (
              <>
                <p className="text-warning">Aucun type de fourniture n’existe encore : créez-en un dans le catalogue.</p>
                <Link href="/dashboard/products" className="font-medium text-primary underline">
                  Ouvrir le catalogue
                </Link>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <FieldLabel htmlFor={id("designation")}>Désignation</FieldLabel>
          <Input
            id={id("designation")}
            size="sm"
            autoComplete="off"
            maxLength={500}
            aria-describedby={id("designation-hint")}
            value={fields.designation}
            onChange={set("designation")}
          />
          <p id={id("designation-hint")} className="text-xs text-muted-foreground">
            Laissée vide, elle est composée du type, de la matière et de la dimension.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <FieldLabel htmlFor={id("reference")}>Référence</FieldLabel>
          <Input id={id("reference")} size="sm" autoComplete="off" maxLength={255} value={fields.reference} onChange={set("reference")} />
        </div>
      </div>
      {learnable ? (
        <LearnAliasChoice
          words={learnable}
          checked={learn}
          size="sm"
          hint="Pour toute l’équipe : les prochaines demandes qui l’écrivent proposeront l’article créé."
          onChange={setLearn}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        loading={busy}
        disabled={hold !== null || supplyTypes.status !== "ready" || none}
        aria-describedby={hold ? id("hold") : undefined}
      >
        <PackagePlus aria-hidden="true" />
        Créer et rattacher
      </Button>
      {hold ? (
        <p id={id("hold")} className="text-xs font-medium text-danger">
          {hold}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Every proposal of one line, a search by hand and the creation of a missing article (TI-690,
 * delivery 3). A pick from the search is recorded as chosen by hand; closing links nothing.
 */
export function MaterialRequestArticleSheet({
  editor,
  line,
  onOpenChange,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  /** The line whose article is being chosen; null closes the panel. */
  line: MaterialRequestLine | null;
  onOpenChange: (open: boolean) => void;
}>) {
  const ids = useId();
  const [mode, setMode] = useState<{ lineId: string; view: "choose" | "create" } | null>(null);
  const [search, setSearch] = useState<{ lineId: string; query: string; result: Search } | null>(null);
  const [linkError, setLinkError] = useState<{ lineId: string; message: string } | null>(null);
  /** « Retenir … comme nom usuel », checked for one line: unchecked again for the next. */
  const [learnFor, setLearnFor] = useState<string | null>(null);

  const lineId = line?.id ?? null;
  const view = mode && mode.lineId === lineId ? mode.view : "choose";
  const current = search && search.lineId === lineId ? search : { lineId, query: "", result: { status: "idle" } as Search };
  const error = linkError && linkError.lineId === lineId ? linkError.message : null;

  const proposals = line ? editor.proposalsOf(line.id) : null;
  const hold = line ? articleLinkHold(editor.lineChanges.get(line.id)) : null;
  const learnable = line ? learnableWords(line.product_type) : null;
  const learning = learnable !== null && learnFor !== null && learnFor === lineId;

  const runSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!line) return;
    const q = current.query.trim();
    if (!q) {
      setSearch({ lineId: line.id, query: current.query, result: { status: "idle" } });
      return;
    }
    setSearch({ lineId: line.id, query: current.query, result: { status: "loading", q } });
    try {
      const candidates = await fetchMaterialRequestLineCandidates(editor.projectId, editor.requestId, line.id, q);
      setSearch((previous) =>
        previous && previous.lineId === line.id ? { ...previous, result: { status: "ready", q, candidates } } : previous,
      );
    } catch (failure) {
      setSearch((previous) =>
        previous && previous.lineId === line.id
          ? {
              ...previous,
              result: { status: "error", q, message: materialRequestErrorMessage(failure, "La recherche n’a pas abouti.") },
            }
          : previous,
      );
    }
  };

  const settle = async (result: SaveResult) => {
    if (!line) return result;
    // A line that changed since it was read was read again: the panel closes on the line as it now is,
    // with the server's sentence beside it.
    if (result.ok || result.blocked) {
      setLinkError(null);
      setSearch(null);
      setMode(null);
      onOpenChange(false);
    } else {
      setLinkError({ lineId: line.id, message: result.message });
    }
    return result;
  };

  const link = async (candidate: MaterialRequestArticleCandidate, searched: boolean) => {
    if (!line) return;
    await settle(
      await editor.linkArticle(line.id, {
        product_id: candidate.article.id,
        via: searched ? "manual" : candidate.via,
        ...(learning ? { learn_alias: true } : {}),
      }),
    );
  };

  const searched = current.result.status !== "idle";
  const listed: MaterialRequestArticleCandidate[] =
    current.result.status === "ready"
      ? current.result.candidates
      : !searched && proposals?.status === "ready"
        ? proposals.candidates
        : [];

  return (
    <Sheet open={line !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {line ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle>Article de la ligne {line.position}</SheetTitle>
              <SheetDescription>
                {lineTitle(line)}
                {line.original_text ? ` · Texte du technicien : « ${line.original_text} »` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              {hold ? (
                <Alert variant="warning">
                  <AlertDescription>{hold}</AlertDescription>
                </Alert>
              ) : line.status === "validated" ? (
                <p className="text-sm text-muted-foreground">{REOPENS_ON_LINK}</p>
              ) : null}
              {view === "create" ? (
                <ArticleCreationForm
                  line={line}
                  request={editor.data.request}
                  hold={hold}
                  onCreate={async (input) => {
                    const result = await editor.createArticle(line.id, input);
                    if (result.ok || result.blocked) await settle(result);
                    return result;
                  }}
                  onBack={() => setMode({ lineId: line.id, view: "choose" })}
                />
              ) : (
                <>
                  <form role="search" className="space-y-1.5" onSubmit={(event) => void runSearch(event)}>
                    <FieldLabel htmlFor={`${ids}-q`}>Chercher dans le catalogue</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id={`${ids}-q`}
                        type="search"
                        size="sm"
                        autoComplete="off"
                        maxLength={200}
                        aria-describedby={`${ids}-q-hint`}
                        value={current.query}
                        onChange={(event) => {
                          const query = event.currentTarget.value;
                          setSearch({ lineId: line.id, query, result: current.result });
                        }}
                      />
                      <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0" loading={current.result.status === "loading"}>
                        <Search aria-hidden="true" />
                        Chercher
                      </Button>
                    </div>
                    <p id={`${ids}-q-hint`} className="text-xs text-muted-foreground">
                      Vos mots remplacent le type de la ligne ; sa dimension et sa matière restent.
                    </p>
                  </form>

                  <section aria-labelledby={`${ids}-list`} className="space-y-2">
                    <h3 id={`${ids}-list`} className="text-sm font-semibold text-foreground">
                      {searched ? `Résultats pour « ${current.result.status === "idle" ? "" : current.result.q} »` : "Propositions"}
                    </h3>
                    {current.result.status === "loading" ? <p className="text-sm text-muted-foreground">Recherche…</p> : null}
                    {current.result.status === "error" ? <p className="text-sm text-danger">{current.result.message}</p> : null}
                    {!searched && (proposals?.status === "loading" || proposals?.status === "stale") ? (
                      <p className="text-sm text-muted-foreground">Recherche d’articles…</p>
                    ) : null}
                    {!searched && proposals?.status === "error" ? (
                      <p className="text-sm text-muted-foreground">Propositions indisponibles : cherchez un article ci-dessus.</p>
                    ) : null}
                    {(current.result.status === "ready" || (!searched && proposals?.status === "ready")) && listed.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {searched ? "Aucun article trouvé." : "Aucun article proposé."}
                      </p>
                    ) : null}
                    {listed.length > 0 && learnable ? (
                      <LearnAliasChoice
                        words={learnable}
                        checked={learning}
                        size="sm"
                        hint="Pour toute l’équipe : les prochaines demandes qui l’écrivent proposeront l’article que vous rattachez. Rien n’est retenu s’il porte déjà ce nom."
                        onChange={(checked) => setLearnFor(checked ? line.id : null)}
                      />
                    ) : null}
                    {listed.length > 0 ? (
                      <ul className="space-y-2">
                        {listed.map((candidate) => (
                          <CandidateItem
                            key={candidate.article.id}
                            candidate={candidate}
                            hold={hold}
                            onLink={() => link(candidate, searched)}
                          />
                        ))}
                      </ul>
                    ) : null}
                    {error ? (
                      <p role="alert" className="text-sm font-medium text-danger">
                        {error}
                      </p>
                    ) : null}
                  </section>

                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">L’article n’est pas au catalogue ?</p>
                    <Button type="button" variant="outline" onClick={() => setMode({ lineId: line.id, view: "create" })}>
                      <PackagePlus aria-hidden="true" />
                      Créer l’article
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
