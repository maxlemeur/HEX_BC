"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

import { TakeoffPreparationSourcePreview } from "@/components/takeoff/TakeoffPreparationSourcePreview";
import { TakeoffPreparationQuestionInput } from "@/components/takeoff/TakeoffPreparationQuestionInput";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { orderTakeoffPreparationQuestions } from "@/lib/takeoff/preparation-assistance";
import { TAKEOFF_PREPARATION_OBJECTIVES, type TakeoffPreparation } from "@/lib/takeoff/preparation";

export type PreparationSourceOption = TakeoffPreparation["sources"][number] & {
  plan_set_id?: string | null;
  file_path?: string | null;
  page_count?: number | null;
};

type Props = {
  draft: TakeoffPreparation;
  onChange: (draft: TakeoffPreparation) => void;
  step: number;
  projectId: string;
  availableSources: PreparationSourceOption[];
  localPreviewUrl?: string | null;
  orderedQuestionIds?: string[];
};

function ListField({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState(values.join(", "));
  useEffect(() => {
    const parsed = text.split(",").map((value) => value.trim()).filter(Boolean);
    if (JSON.stringify(parsed) !== JSON.stringify(values)) setText(values.join(", "));
  }, [text, values]);
  return <label htmlFor={id} className="block space-y-1 text-sm font-medium">
    <span>{label}</span>
    <Input id={id} value={text} onChange={(event) => { setText(event.target.value); onChange(event.target.value.split(",").map((value) => value.trim()).filter(Boolean)); }} placeholder="Séparez les valeurs par une virgule" />
  </label>;
}

function PagesField({ name, pages, onChange }: { name: string; pages: number[]; onChange: (pages: number[]) => void }) {
  const [text, setText] = useState(pages.join(", "));
  const parse = (value: string) => value.trim() === "" ? [] : value.split(",").map((part) => /^\s*[1-9]\d*\s*$/.test(part) ? Number(part) : -1);
  const invalid = parse(text).some((page) => page < 1);
  useEffect(() => { if (JSON.stringify(parse(text)) !== JSON.stringify(pages)) setText(pages.join(", ")); }, [pages, text]);
  return <label className="space-y-1 text-sm"><span>Pages de {name}</span><Input aria-label={`Pages de ${name}`} aria-invalid={invalid} value={text} placeholder="Toutes les pages" onChange={(event) => { setText(event.target.value); onChange(parse(event.target.value)); }} />{invalid && <span className="block text-xs text-danger">Indiquez des pages entières positives séparées par des virgules. Aucune page invalide ne sera ignorée.</span>}</label>;
}

export function PreparationConfirmation({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-subtle p-3 text-sm">
    <input type="checkbox" className="mt-0.5 size-4" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

function OptionalNumber({ label, value, onChange, min = 0 }: { label: string; value: number | null; min?: number; onChange: (value: number | null) => void }) {
  const id = useId();
  return <label htmlFor={id} className="block space-y-1 text-sm font-medium"><span>{label}</span>
    <Input id={id} type="number" step="any" min={min} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} placeholder="Inconnu" />
  </label>;
}

export function TakeoffPreparationFields({ draft, onChange, step, projectId, availableSources, localPreviewUrl, orderedQuestionIds = [] }: Props) {
  const id = useId();
  const changeSource = (documentId: string, patch: Partial<TakeoffPreparation["sources"][number]>) => {
    onChange({ ...draft, sources: draft.sources.map((source) => source.document_id === documentId ? { ...source, ...patch, confirmed: false } : source) });
  };
  const changeScope = (key: "lots" | "networks" | "levels" | "zones" | "inclusions" | "exclusions", values: string[]) => {
    onChange({ ...draft, scope: { ...draft.scope, [key]: values, confirmed: false } });
  };
  const changeConventions = (patch: Partial<TakeoffPreparation["conventions"]>) => {
    onChange({ ...draft, conventions: { ...draft.conventions, ...patch, confirmed: false } });
  };

  const changeCalibration = (patch: Partial<NonNullable<TakeoffPreparation["conventions"]["calibration"]>>) => changeConventions({ calibration: { document_id: null, page: null, reference_length: null, reference_unit: null, measured_span: null, measured_span_unit: null, ...draft.conventions.calibration, ...patch } });

  if (step === 0) return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Choisissez les pièces actives, leur révision et les pages concernées. Une pièce remplacée reste dans le dossier et ne doit pas être additionnée.</p>
    {draft.sources.map((source) => <div key={source.document_id} className="space-y-3 rounded-lg border border-border p-3">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" className="mt-0.5 size-4" checked={source.active} onChange={(event) => changeSource(source.document_id, { active: event.target.checked })} aria-label={`Utiliser ${source.document_name}`} />
        <span className="min-w-0 break-words">{source.document_name}<span className="ml-2 text-xs font-normal text-muted-foreground">{source.confirmed ? "Confirmé" : "À confirmer"}</span></span>
      </label>
      {source.active && <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Révision de {source.document_name}</span><Input aria-label={`Révision de ${source.document_name}`} value={source.revision ?? ""} placeholder="Révision inconnue" onChange={(event) => changeSource(source.document_id, { revision: event.target.value.trim() || null })} /></label>
        <PagesField name={source.document_name} pages={source.pages} onChange={(pages) => changeSource(source.document_id, { pages })} />
      </div>}
      {source.active && <label className="block space-y-1 text-sm"><span>Référence du plan de {source.document_name}</span><Input value={source.logical_document_id ?? ""} placeholder="Même référence pour les révisions du même document" onChange={(event) => changeSource(source.document_id, { logical_document_id: event.target.value.trim() || null })} /><span className="block text-xs text-muted-foreground">Les pièces ayant cette même référence représentent un même document. Choisissez une seule révision active.</span></label>}
      <TakeoffPreparationSourcePreview projectId={projectId} documentId={source.document_id} name={source.document_name} page={source.pages[0]} localPreviewUrl={source.document_id.startsWith("upload:") ? localPreviewUrl : null} />
      {source.active && !source.revision && <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Révision inconnue : précisez-la ou conservez une réserve attribuée.</p>
        <label className="block space-y-1"><span>Motif de réserve pour {source.document_name}</span><Input value={draft.unknowns.find((unknown) => unknown.id === `source_revision:${source.document_id}`)?.answer ?? ""} onChange={(event) => {
          const unknownId = `source_revision:${source.document_id}`;
          const previous = draft.unknowns.find((unknown) => unknown.id === unknownId);
          const next = { id: unknownId, question: `Révision inconnue de ${source.document_name}`, impact: "reservation" as const, status: "open" as const, answer: event.target.value || null, responsible: previous?.responsible ?? null, source_document_id: source.document_id, page: null };
          onChange({ ...draft, unknowns: [...draft.unknowns.filter((unknown) => unknown.id !== unknownId), next] });
        }} /></label>
        <label className="block space-y-1"><span>Responsable de la réserve pour {source.document_name}</span><Input value={draft.unknowns.find((unknown) => unknown.id === `source_revision:${source.document_id}`)?.responsible ?? ""} onChange={(event) => {
          const unknownId = `source_revision:${source.document_id}`;
          const previous = draft.unknowns.find((unknown) => unknown.id === unknownId);
          const next = { id: unknownId, question: `Révision inconnue de ${source.document_name}`, impact: "reservation" as const, status: "open" as const, answer: previous?.answer ?? null, responsible: event.target.value || null, source_document_id: source.document_id, page: null };
          onChange({ ...draft, unknowns: [...draft.unknowns.filter((unknown) => unknown.id !== unknownId), next] });
        }} /></label>
        <PreparationConfirmation label={`J'accepte la réserve de révision pour ${source.document_name}`} checked={draft.unknowns.some((unknown) => unknown.id === `source_revision:${source.document_id}` && unknown.status === "accepted")} onChange={(checked) => onChange({ ...draft, unknowns: draft.unknowns.map((unknown) => unknown.id === `source_revision:${source.document_id}` ? { ...unknown, status: checked ? "accepted" : "open" } : unknown) })} />
      </div>}
    </div>)}
    {draft.sources.length === 0 && <p className="text-sm text-muted-foreground">Aucune pièce disponible. Ajoutez vos documents avant de poursuivre.</p>}
    <PreparationConfirmation label="Je confirme les pièces actives et leurs révisions" checked={draft.sources.some((source) => source.active) && draft.sources.filter((source) => source.active).every((source) => source.confirmed)} onChange={(checked) => onChange({ ...draft, sources: draft.sources.map((source) => ({ ...source, confirmed: source.active && checked })) })} />
    <Link href={`/dashboard/affaires/${projectId}/plans`} className="text-sm text-primary underline">Consulter les plans du dossier</Link>
  </div>;

  if (step === 1) return <div className="space-y-4">
    <label htmlFor={`${id}-objective`} className="block space-y-1 text-sm font-medium"><span>Objectif du métré</span>
      <NativeSelect id={`${id}-objective`} value={draft.objective ?? ""} onChange={(event) => onChange({ ...draft, objective: event.target.value ? event.target.value as TakeoffPreparation["objective"] : null, objective_confirmed: false, conventions: { ...draft.conventions, confirmed: false } })}>
        <option value="">Choisir le résultat attendu</option>
        {Object.entries(TAKEOFF_PREPARATION_OBJECTIVES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>
    </label>
    <PreparationConfirmation label="Je confirme cet objectif" checked={draft.objective_confirmed} onChange={(checked) => onChange({ ...draft, objective_confirmed: checked })} />
    <p className="text-sm text-muted-foreground">Un champ laissé vide reste inconnu. Pour un périmètre complet, indiquez explicitement « Tous » dans les champs concernés.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <ListField label="Lots" values={draft.scope.lots} onChange={(values) => changeScope("lots", values)} />
      <ListField label="Réseaux" values={draft.scope.networks} onChange={(values) => changeScope("networks", values)} />
      <ListField label="Niveaux" values={draft.scope.levels} onChange={(values) => changeScope("levels", values)} />
      <ListField label="Zones" values={draft.scope.zones} onChange={(values) => changeScope("zones", values)} />
      <ListField label="Inclusions" values={draft.scope.inclusions} onChange={(values) => changeScope("inclusions", values)} />
      <ListField label="Exclusions" values={draft.scope.exclusions} onChange={(values) => changeScope("exclusions", values)} />
    </div>
    <PreparationConfirmation label="Je confirme ce périmètre" checked={draft.scope.confirmed} onChange={(checked) => onChange({ ...draft, scope: { ...draft.scope, confirmed: checked } })} />
  </div>;

  if (step === 2) return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${id}-unit`} className="space-y-1 text-sm font-medium"><span>Unité de restitution</span><Input id={`${id}-unit`} value={draft.conventions.unit ?? ""} onChange={(event) => changeConventions({ unit: event.target.value || null })} placeholder="u, m, m²…" /></label>
      <label htmlFor={`${id}-basis`} className="space-y-1 text-sm font-medium"><span>Base de mesure</span><NativeSelect id={`${id}-basis`} value={draft.conventions.measurement_basis} onChange={(event) => changeConventions({ measurement_basis: event.target.value as TakeoffPreparation["conventions"]["measurement_basis"], calibration: null })}>
        <option value="unknown">Inconnue</option><option value="documented">Quantités ou comptage documentaire</option><option value="dimensioned">Cotes explicites sur le plan</option><option value="calibrated">Calibration vérifiée</option>
      </NativeSelect></label>
    </div>
    {draft.conventions.measurement_basis === "calibrated" && <fieldset className="space-y-3 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Calibration du plan</legend>
      <label htmlFor={`${id}-calibration-source`} className="block space-y-1 text-sm"><span>Plan de calibration</span><NativeSelect id={`${id}-calibration-source`} value={draft.conventions.calibration?.document_id ?? ""} onChange={(event) => changeCalibration({ document_id: event.target.value || null })}><option value="">Choisir une pièce active</option>{draft.sources.filter((source) => source.active && source.kind === "plan").map((source) => <option key={source.document_id} value={source.document_id}>{source.document_name}</option>)}</NativeSelect></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionalNumber label="Page de calibration" min={1} value={draft.conventions.calibration?.page ?? null} onChange={(value) => changeCalibration({ page: value })} />
        <OptionalNumber label="Longueur de référence" value={draft.conventions.calibration?.reference_length ?? null} onChange={(value) => changeCalibration({ reference_length: value })} />
        <label className="block space-y-1 text-sm"><span>Unité de la référence</span><NativeSelect value={draft.conventions.calibration?.reference_unit ?? ""} onChange={(event) => changeCalibration({ reference_unit: event.target.value as "m" | "cm" | "mm" || null })}><option value="">À préciser</option><option value="m">Mètres</option><option value="cm">Centimètres</option><option value="mm">Millimètres</option></NativeSelect></label>
        <label className="block space-y-1 text-sm"><span>Unité de portée sur le plan</span><NativeSelect value={draft.conventions.calibration?.measured_span_unit ?? ""} onChange={(event) => changeCalibration({ measured_span_unit: event.target.value as "pdf_points" | "paper_mm" || null })}><option value="">À préciser</option><option value="pdf_points">Points PDF du document original</option><option value="paper_mm">Millimètres sur le plan à 100 %</option></NativeSelect></label>
        <OptionalNumber label={`Portée mesurée sur le plan${draft.conventions.calibration?.measured_span_unit === "pdf_points" ? " (points PDF)" : draft.conventions.calibration?.measured_span_unit === "paper_mm" ? " (mm à 100 %)" : ""}`} value={draft.conventions.calibration?.measured_span ?? null} onChange={(value) => changeCalibration({ measured_span: value })} />
      </div>
      <p className="text-xs text-muted-foreground">La référence couvre une page et sa version. Une distance lue en pixels dans un aperçu redimensionné ne permet pas une calibration reproductible.</p>
    </fieldset>}
    {draft.objective === "prepare_purchase" && <fieldset className="space-y-3 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Conventions d&apos;achat</legend>
      <label className="block space-y-1 text-sm"><span>Déductions</span><Input value={draft.conventions.purchase?.deductions ?? ""} onChange={(event) => changeConventions({ purchase: { deductions: event.target.value, waste_percent: draft.conventions.purchase?.waste_percent ?? null, rounding: draft.conventions.purchase?.rounding ?? "", packaging: draft.conventions.purchase?.packaging ?? "" } })} /></label>
      <OptionalNumber label="Pertes (%)" value={draft.conventions.purchase?.waste_percent ?? null} onChange={(value) => changeConventions({ purchase: { deductions: draft.conventions.purchase?.deductions ?? "", waste_percent: value, rounding: draft.conventions.purchase?.rounding ?? "", packaging: draft.conventions.purchase?.packaging ?? "" } })} />
      <label className="block space-y-1 text-sm"><span>Arrondi d&apos;achat</span><Input value={draft.conventions.purchase?.rounding ?? ""} onChange={(event) => changeConventions({ purchase: { deductions: draft.conventions.purchase?.deductions ?? "", waste_percent: draft.conventions.purchase?.waste_percent ?? null, rounding: event.target.value, packaging: draft.conventions.purchase?.packaging ?? "" } })} /></label>
      <label className="block space-y-1 text-sm"><span>Conditionnement</span><Input value={draft.conventions.purchase?.packaging ?? ""} onChange={(event) => changeConventions({ purchase: { deductions: draft.conventions.purchase?.deductions ?? "", waste_percent: draft.conventions.purchase?.waste_percent ?? null, rounding: draft.conventions.purchase?.rounding ?? "", packaging: event.target.value } })} /></label>
    </fieldset>}
    <PreparationConfirmation label="Je confirme les conventions de mesure" checked={draft.conventions.confirmed} onChange={(checked) => onChange({ ...draft, conventions: { ...draft.conventions, confirmed: checked } })} />
    <TakeoffPreparationQuestionInput draft={draft} onChange={onChange} />
    {orderTakeoffPreparationQuestions(draft.unknowns, orderedQuestionIds).map((unknown) => <fieldset key={unknown.id} className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{unknown.question}</legend>
      <p className="text-xs text-muted-foreground">{unknown.impact === "blocking" ? "Réponse requise pour l'objectif choisi." : "Une réserve motivée et attribuée peut être conservée."}{unknown.source_document_id ? ` Source : ${draft.sources.find((source) => source.document_id === unknown.source_document_id)?.document_name ?? unknown.source_document_id}${unknown.page ? `, page ${unknown.page}` : ""}.` : ""}</p>
      <label className="block space-y-1 text-sm"><span>Réponse à {unknown.question}</span><Textarea value={unknown.answer ?? ""} onChange={(event) => onChange({ ...draft, unknowns: draft.unknowns.map((item) => item.id === unknown.id ? { ...item, answer: event.target.value || null, status: "open" } : item) })} /></label>
      <label className="block space-y-1 text-sm"><span>Responsable de {unknown.question}</span><Input value={unknown.responsible ?? ""} onChange={(event) => onChange({ ...draft, unknowns: draft.unknowns.map((item) => item.id === unknown.id ? { ...item, responsible: event.target.value || null, status: "open" } : item) })} /></label>
      <label className="block space-y-1 text-sm"><span>Décision pour {unknown.question}</span><NativeSelect value={unknown.status} onChange={(event) => onChange({ ...draft, unknowns: draft.unknowns.map((item) => item.id === unknown.id ? { ...item, status: event.target.value as typeof item.status } : item) })}><option value="open">À préciser</option><option value="answered">Réponse confirmée</option>{unknown.impact === "reservation" && <option value="accepted">Réserve acceptée</option>}<option value="excluded">Exclu explicitement du périmètre</option></NativeSelect></label>
      {unknown.source_document_id && availableSources.some((source) => source.document_id === unknown.source_document_id) && <TakeoffPreparationSourcePreview projectId={projectId} documentId={unknown.source_document_id} name={draft.sources.find((source) => source.document_id === unknown.source_document_id)?.document_name ?? "la pièce concernée"} page={unknown.page} localPreviewUrl={unknown.source_document_id.startsWith("upload:") ? localPreviewUrl : null} />}
    </fieldset>)}
  </div>;

  return <div className="space-y-4">
    <label htmlFor={`${id}-destination`} className="block space-y-1 text-sm font-medium"><span>Destination des résultats</span><NativeSelect id={`${id}-destination`} value={draft.destination.kind} onChange={(event) => onChange({ ...draft, destination: { ...draft.destination, kind: event.target.value as TakeoffPreparation["destination"]["kind"], confirmed: false } })}><option value="analysis_only">Analyse et revue uniquement</option><option value="estimate_review">Propositions pour le devis après revue</option></NativeSelect></label>
    <dl className="grid gap-3 rounded-lg border border-border bg-surface-subtle p-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Résultat attendu</dt><dd className="mt-1 font-medium">{draft.objective ? TAKEOFF_PREPARATION_OBJECTIVES[draft.objective] : "À préciser"}</dd></div>
      <div><dt className="text-muted-foreground">Sources actives</dt><dd className="mt-1">{draft.sources.filter((source) => source.active).map((source) => `${source.document_name} · ${source.revision ?? "révision inconnue"}${source.pages.length ? ` · pages ${source.pages.join(", ")}` : " · toutes les pages"}`).join(" ; ") || "Aucune"}</dd></div>
      <div><dt className="text-muted-foreground">Périmètre</dt><dd className="mt-1">{[...draft.scope.lots, ...draft.scope.networks, ...draft.scope.levels, ...draft.scope.zones, ...draft.scope.inclusions].join(" · ") || "À préciser"}</dd></div>
      <div><dt className="text-muted-foreground">Exclusions</dt><dd className="mt-1">{draft.scope.exclusions.join(" · ") || "Aucune exclusion déclarée"}</dd></div>
      <div><dt className="text-muted-foreground">Conventions</dt><dd className="mt-1">{({ unknown: "Base inconnue", documented: "Comptage ou quantités documentaires", dimensioned: "Cotes explicites", calibrated: "Calibration vérifiée" })[draft.conventions.measurement_basis]} · {draft.conventions.unit ?? "unité inconnue"}</dd></div>
      {draft.profile && <div><dt className="text-muted-foreground">Profil</dt><dd className="mt-1">{draft.profile.name} · version {draft.profile.version}</dd></div>}
    </dl>
    <label htmlFor={`${id}-reviewer`} className="block space-y-1 text-sm font-medium"><span>Responsable de la revue</span><Input id={`${id}-reviewer`} value={draft.destination.reviewer ?? ""} onChange={(event) => onChange({ ...draft, destination: { ...draft.destination, reviewer: event.target.value || null, confirmed: false } })} /></label>
    <PreparationConfirmation label="Je confirme la destination et la revue des résultats" checked={draft.destination.confirmed} onChange={(checked) => onChange({ ...draft, destination: { ...draft.destination, confirmed: checked } })} />
    <p className="text-sm text-muted-foreground">Le lancement transmet ce cadrage à l&apos;analyse. Les quantités produites restent à vérifier avant toute application au devis. Une estimation reste une hypothèse même après confirmation.</p>
  </div>;
}
