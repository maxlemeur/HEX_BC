"use client";

import { useState } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { formatCurrency } from "@/lib/money";

import type {
  GeneratedOuvrageSubdetailEditorComponent,
} from "./generated-ouvrage-types";
import type {
  GeneratedOuvrageRiskSignal,
  GeneratedOuvrageSubdetailResult,
} from "@/lib/estimates/generated-ouvrages";

type GeneratedOuvrageSubdetailEditorProps = {
  candidateLabel: string;
  subdetail: GeneratedOuvrageSubdetailResult;
  isSaving: boolean;
  onSave: (components: GeneratedOuvrageSubdetailEditorComponent[]) => Promise<void> | void;
};

function emptyComponent(): GeneratedOuvrageSubdetailEditorComponent {
  return {
    componentId: null,
    status: "manual",
    costType: "material",
    designation: "",
    unit: null,
    quantity: 1,
    unitCostHtCents: 0,
    lossCoeffBp: 0,
    yieldValue: null,
    yieldUnit: null,
    confidence: 0.55,
    sourceLabel: "Saisie manuelle",
    facts: [],
    hypotheses: [],
    inferences: [],
    riskSignals: [],
    sources: [],
  };
}

function toEditableComponents(
  subdetail: GeneratedOuvrageSubdetailResult
): GeneratedOuvrageSubdetailEditorComponent[] {
  return subdetail.components.map((component) => ({
    componentId: component.componentId,
    status: component.status,
    costType: component.costType,
    designation: component.designation,
    unit: component.unit,
    quantity: component.quantity,
    unitCostHtCents: component.unitCostHtCents,
    lossCoeffBp: component.lossCoeffBp,
    yieldValue: component.yieldValue,
    yieldUnit: component.yieldUnit,
    confidence: component.confidence,
    sourceLabel: component.sourceLabel,
    facts: component.facts,
    hypotheses: component.hypotheses,
    inferences: component.inferences,
    riskSignals: component.riskSignals,
    sources: component.sources.map((source) => ({
      sourceFragmentId: source.sourceFragmentId,
      evidenceKind: source.evidenceKind,
      note: source.note,
    })),
  }));
}

function parseLines(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function serializeComponents(
  components: GeneratedOuvrageSubdetailEditorComponent[]
) {
  return JSON.stringify(components);
}

function riskBadgeVariant(signal: GeneratedOuvrageRiskSignal["severity"]) {
  if (signal === "critical") return "error" as const;
  if (signal === "warning") return "warning" as const;
  return "neutral" as const;
}

function computeComponentDsCents(component: GeneratedOuvrageSubdetailEditorComponent) {
  return Math.round(
    component.quantity *
      component.unitCostHtCents *
      (1 + component.lossCoeffBp / 10_000)
  );
}

export function GeneratedOuvrageSubdetailEditor({
  subdetail,
  ...props
}: GeneratedOuvrageSubdetailEditorProps) {
  return (
    <GeneratedOuvrageSubdetailEditorForm
      key={`${subdetail.draftId}:${subdetail.updatedAt}`}
      subdetail={subdetail}
      {...props}
    />
  );
}

function GeneratedOuvrageSubdetailEditorForm({
  candidateLabel,
  subdetail,
  isSaving,
  onSave,
}: GeneratedOuvrageSubdetailEditorProps) {
  const [components, setComponents] = useState<GeneratedOuvrageSubdetailEditorComponent[]>(
    () => toEditableComponents(subdetail)
  );
  const [expandedComponentIndex, setExpandedComponentIndex] = useState(0);

  const dsCents = components.reduce(
    (total, component) => total + computeComponentDsCents(component),
    0
  );
  const marginMultiplier =
    subdetail.summary.dsCents > 0
      ? subdetail.summary.indicativeTargetPriceCents / subdetail.summary.dsCents
      : 1;
  const indicativeTargetPriceCents = Math.round(dsCents * marginMultiplier);
  const reviewStateIsCurrent =
    subdetail.status === "reviewed" &&
    serializeComponents(components) ===
      serializeComponents(toEditableComponents(subdetail));

  function updateComponent(
    index: number,
    patch: Partial<GeneratedOuvrageSubdetailEditorComponent>
  ) {
    setComponents((prev) =>
      prev.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              ...patch,
              status:
                component.status === "manual" ||
                Object.entries(patch).some(([key, value]) => {
                  const currentValue =
                    component[key as keyof GeneratedOuvrageSubdetailEditorComponent];
                  return !Object.is(currentValue, value);
                })
                  ? "manual"
                  : component.status,
            }
          : component
      )
    );
  }

  function addComponent() {
    setComponents((prev) => [...prev, emptyComponent()]);
    setExpandedComponentIndex(components.length);
  }

  function removeComponent(index: number) {
    setComponents((prev) => prev.filter((_, componentIndex) => componentIndex !== index));
    setExpandedComponentIndex((current) => {
      if (current === index) return Math.max(index - 1, 0);
      if (current > index) return current - 1;
      return current;
    });
  }

  function duplicateComponent(index: number) {
    setComponents((prev) => {
      const component = prev[index];
      if (!component) return prev;
      return [
        ...prev.slice(0, index + 1),
        { ...component, componentId: null, status: "manual" },
        ...prev.slice(index + 1),
      ];
    });
    setExpandedComponentIndex(index + 1);
  }

  function splitComponent(index: number) {
    setComponents((prev) => {
      const component = prev[index];
      if (!component) return prev;
      const firstHalf = Math.max(Number((component.quantity / 2).toFixed(3)), 0.001);
      const secondHalf = Math.max(
        Number((component.quantity - firstHalf).toFixed(3)),
        0.001
      );
      return [
        ...prev.slice(0, index),
        { ...component, quantity: firstHalf },
        {
          ...component,
          componentId: null,
          quantity: secondHalf,
          status: "manual",
          sourceLabel: "Scission manuelle",
        },
        ...prev.slice(index + 1),
      ];
    });
    setExpandedComponentIndex(index + 1);
  }

  function mergeWithPrevious(index: number) {
    if (index === 0) return;
    setComponents((prev) => {
      const current = prev[index];
      const previous = prev[index - 1];
      if (!current || !previous || current.costType !== previous.costType) {
        return prev;
      }

      const merged: GeneratedOuvrageSubdetailEditorComponent = {
        ...previous,
        quantity: Number((previous.quantity + current.quantity).toFixed(3)),
        designation:
          previous.designation === current.designation
            ? previous.designation
            : `${previous.designation} + ${current.designation}`,
        facts: Array.from(new Set([...previous.facts, ...current.facts])).slice(0, 8),
        hypotheses: Array.from(
          new Set([...previous.hypotheses, ...current.hypotheses])
        ).slice(0, 8),
        inferences: Array.from(
          new Set([...previous.inferences, ...current.inferences])
        ).slice(0, 8),
        riskSignals: Array.from(
          new Map(
            [...previous.riskSignals, ...current.riskSignals].map((signal) => [
              `${signal.severity}:${signal.basis}:${signal.label}`,
              signal,
            ])
          ).values()
        ).slice(0, 8),
      };

      return [
        ...prev.slice(0, index - 1),
        merged,
        ...prev.slice(index + 1),
      ];
    });
    setExpandedComponentIndex(index - 1);
  }

  async function handleSave() {
    const sanitized = components
      .map((component) => ({
        ...component,
        designation: component.designation.trim(),
        unit: component.unit?.trim() || null,
        yieldUnit: component.yieldUnit?.trim() || null,
        sourceLabel: component.sourceLabel?.trim() || null,
      }))
      .filter((component) => component.designation.length > 0);

    await onSave(sanitized);
  }

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Sous-detail compose
          </p>
          <h4 className="mt-1 text-sm font-semibold text-slate-900">{candidateLabel}</h4>
          <p className="mt-1 text-xs text-slate-500">
            Validation humaine requise avant insertion. Les couts restent indicatifs
            tant que les hypotheses ne sont pas confirmées.
          </p>
          {reviewStateIsCurrent ? (
            <p className="mt-2 text-xs font-medium text-emerald-700">
              Revue enregistree. Aucun changement local depuis la validation.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral" size="sm">
            {components.length} composant(s)
          </Badge>
          <Badge variant="info" size="sm">
            DS {formatCurrency(dsCents, "EUR")}
          </Badge>
          <Badge variant="success" size="sm">
            Prix cible {formatCurrency(indicativeTargetPriceCents, "EUR")}
          </Badge>
          <Badge variant={subdetail.status === "reviewed" ? "success" : "warning"} size="sm">
            {subdetail.status === "reviewed" ? "Revu" : "A revoir"}
          </Badge>
        </div>
      </div>

      {subdetail.summary.riskSignals.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {subdetail.summary.riskSignals.map((signal) => (
            <Badge
              key={`${signal.severity}-${signal.basis}-${signal.label}`}
              variant={riskBadgeVariant(signal.severity)}
              size="sm"
            >
              {signal.label}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {components.map((component, index) => {
          const componentDsCents = computeComponentDsCents(component);
          const isExpanded = expandedComponentIndex === index;

          return (
            <article
              key={`${component.componentId ?? "new"}-${index}`}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <button
                type="button"
                className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between"
                onClick={() =>
                  setExpandedComponentIndex((current) =>
                    current === index ? -1 : index
                  )
                }
                aria-expanded={isExpanded}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral" size="sm">
                      {component.costType}
                    </Badge>
                    <Badge variant="info" size="sm">
                      {Math.round(component.confidence * 100)}% confiance
                    </Badge>
                    <Badge
                      variant={component.status === "manual" ? "warning" : "neutral"}
                      size="sm"
                    >
                      {component.status === "manual" ? "Saisi manuellement" : "Suggere"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {component.designation || "Composant sans désignation"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {component.quantity} {component.unit ?? "u"} · DS{" "}
                      {formatCurrency(componentDsCents, "EUR")}
                      {" · "}
                      {component.facts.length} fait(s), {component.hypotheses.length} hypothese(s),
                      {" "}
                      {component.inferences.length} inference(s), {component.sources.length} source(s)
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-slate-500">
                  {isExpanded ? "Replier" : "Developper"}
                </span>
              </button>

              {isExpanded ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => duplicateComponent(index)}
                    >
                      Dupliquer
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => splitComponent(index)}
                    >
                      Scinder
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => mergeWithPrevious(index)}
                      disabled={index === 0}
                    >
                      Fusionner
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      onClick={() => removeComponent(index)}
                      disabled={components.length === 1}
                    >
                      Supprimer
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-6">
                    <div className="md:col-span-2">
                      <label className="label text-xs font-medium">Designation</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={component.designation}
                        onChange={(event) =>
                          updateComponent(index, { designation: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Type</label>
                      <select
                        className="select select-bordered select-sm w-full"
                        value={component.costType}
                        onChange={(event) =>
                          updateComponent(index, {
                            costType:
                              event.target.value as GeneratedOuvrageSubdetailEditorComponent["costType"],
                          })
                        }
                      >
                        <option value="material">Materiau</option>
                        <option value="labor">Main d&apos;oeuvre</option>
                        <option value="equipment">Materiel</option>
                        <option value="subcontract">Sous-traitance</option>
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Unite</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={component.unit ?? ""}
                        onChange={(event) =>
                          updateComponent(index, { unit: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Quantite</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={String(component.quantity)}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateComponent(index, {
                            quantity:
                              Number.parseFloat(event.target.value.replace(",", ".")) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Cout unitaire HT</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={String(component.unitCostHtCents)}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateComponent(index, {
                            unitCostHtCents:
                              Number.parseInt(event.target.value || "0", 10) || 0,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-5">
                    <div>
                      <label className="label text-xs font-medium">Pertes (bp)</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={String(component.lossCoeffBp)}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateComponent(index, {
                            lossCoeffBp:
                              Number.parseInt(event.target.value || "0", 10) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Rendement</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={component.yieldValue ?? ""}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateComponent(index, {
                            yieldValue: event.target.value.trim()
                              ? Number.parseFloat(event.target.value.replace(",", "."))
                              : null,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Unite rendement</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={component.yieldUnit ?? ""}
                        onChange={(event) =>
                          updateComponent(index, { yieldUnit: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">Confiance</label>
                      <input
                        className="input input-bordered input-sm w-full"
                        value={String(Number(component.confidence.toFixed(2)))}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateComponent(index, {
                            confidence: Math.max(
                              0,
                              Math.min(
                                1,
                                Number.parseFloat(event.target.value.replace(",", ".")) || 0
                              )
                            ),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="label text-xs font-medium">DS composant</label>
                      <div className="input input-bordered input-sm flex items-center bg-slate-50 text-slate-700">
                        {formatCurrency(componentDsCents, "EUR")}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <StatementField
                      label="Faits"
                      value={component.facts.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { facts: parseLines(value) })
                      }
                    />
                    <StatementField
                      label="Hypotheses"
                      value={component.hypotheses.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { hypotheses: parseLines(value) })
                      }
                    />
                    <StatementField
                      label="Inferences"
                      value={component.inferences.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { inferences: parseLines(value) })
                      }
                    />
                  </div>

                  {component.sources.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs font-medium text-slate-600">Provenance composee</p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-500">
                        {component.sources.map((source) => (
                          <li key={`${source.sourceFragmentId}-${source.evidenceKind}`}>
                            {source.evidenceKind} · {source.sourceFragmentId}
                            {source.note ? ` · ${source.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-secondary btn-sm" onClick={addComponent}>
          Ajouter un composant
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={
            isSaving ||
            components.every((component) => !component.designation.trim()) ||
            reviewStateIsCurrent
          }
        >
          {isSaving
            ? "Validation..."
            : reviewStateIsCurrent
              ? "Sous-détail déjà validé"
              : subdetail.status === "reviewed"
                ? "Revalider le sous-detail"
                : "Valider le sous-detail"}
        </button>
      </div>
    </section>
  );
}

function StatementField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label text-xs font-medium">{label}</label>
      <textarea
        className="textarea textarea-bordered min-h-[7rem] w-full text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
