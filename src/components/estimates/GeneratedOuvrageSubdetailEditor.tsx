"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

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

/** Risk labels are free text: wrapping pills instead of single-line badges. */
const RISK_SIGNAL_CLASSES: Record<GeneratedOuvrageRiskSignal["severity"], string> = {
  critical: "border-danger-border bg-danger-subtle text-danger",
  warning: "border-warning-border bg-warning-subtle text-warning",
  info: "border-border bg-muted text-foreground-secondary",
};

const COST_TYPE_LABELS: Record<GeneratedOuvrageSubdetailEditorComponent["costType"], string> = {
  material: "Matériau",
  labor: "Main-d'œuvre",
  equipment: "Matériel",
  subcontract: "Sous-traitance",
};

const EVIDENCE_KIND_LABELS: Record<
  GeneratedOuvrageSubdetailEditorComponent["sources"][number]["evidenceKind"],
  string
> = {
  fact: "Fait",
  hypothesis: "Hypothèse",
  inference: "Inférence",
};

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
  const formId = useId();

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
    <section className="mt-4 rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Sous-détail composé
          </p>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{candidateLabel}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Validation humaine requise avant insertion. Les coûts restent indicatifs
            tant que les hypothèses ne sont pas confirmées.
          </p>
          {reviewStateIsCurrent ? (
            <p className="mt-2 text-xs font-medium text-success">
              Revue enregistrée. Aucun changement local depuis la validation.
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
            {subdetail.status === "reviewed" ? "Revu" : "À revoir"}
          </Badge>
        </div>
      </div>

      {subdetail.summary.riskSignals.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {subdetail.summary.riskSignals.map((signal) => (
            <span
              key={`${signal.severity}-${signal.basis}-${signal.label}`}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-semibold",
                RISK_SIGNAL_CLASSES[signal.severity] ?? RISK_SIGNAL_CLASSES.info
              )}
            >
              {signal.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {components.map((component, index) => {
          const componentDsCents = computeComponentDsCents(component);
          const isExpanded = expandedComponentIndex === index;
          const fieldId = `${formId}-${index}`;

          return (
            <article
              key={`${component.componentId ?? "new"}-${index}`}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <button
                type="button"
                className="flex w-full flex-col gap-3 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-start sm:justify-between"
                onClick={() =>
                  setExpandedComponentIndex((current) =>
                    current === index ? -1 : index
                  )
                }
                aria-expanded={isExpanded}
                aria-controls={isExpanded ? `${fieldId}-panel` : undefined}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="neutral" size="sm">
                      {COST_TYPE_LABELS[component.costType] ?? component.costType}
                    </Badge>
                    <Badge variant="info" size="sm">
                      {`${Math.round(component.confidence * 100)} % confiance`}
                    </Badge>
                    <Badge
                      variant={component.status === "manual" ? "warning" : "neutral"}
                      size="sm"
                    >
                      {component.status === "manual" ? "Saisi manuellement" : "Suggéré"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {component.designation || "Composant sans désignation"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {component.quantity} {component.unit ?? "u"} · DS{" "}
                      {formatCurrency(componentDsCents, "EUR")}
                      {" · "}
                      {component.facts.length} fait(s), {component.hypotheses.length} hypothèse(s),
                      {" "}
                      {component.inferences.length} inférence(s), {component.sources.length} source(s)
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-primary">
                  {isExpanded ? "Replier" : "Développer"}
                </span>
              </button>

              {isExpanded ? (
                <div id={`${fieldId}-panel`}>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => duplicateComponent(index)}
                    >
                      Dupliquer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => splitComponent(index)}
                    >
                      Scinder
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => mergeWithPrevious(index)}
                      disabled={index === 0}
                    >
                      Fusionner
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-danger hover:bg-danger-subtle hover:text-danger"
                      onClick={() => removeComponent(index)}
                      disabled={components.length === 1}
                    >
                      Supprimer
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-6">
                    <div className="space-y-1.5 sm:col-span-2">
                      <FieldLabel htmlFor={`${fieldId}-designation`} className="text-xs">
                        Désignation
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-designation`}
                        size="sm"
                        value={component.designation}
                        onChange={(event) =>
                          updateComponent(index, { designation: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-cost-type`} className="text-xs">
                        Type
                      </FieldLabel>
                      <NativeSelect
                        id={`${fieldId}-cost-type`}
                        size="sm"
                        value={component.costType}
                        onChange={(event) =>
                          updateComponent(index, {
                            costType:
                              event.target.value as GeneratedOuvrageSubdetailEditorComponent["costType"],
                          })
                        }
                      >
                        <option value="material">{COST_TYPE_LABELS.material}</option>
                        <option value="labor">{COST_TYPE_LABELS.labor}</option>
                        <option value="equipment">{COST_TYPE_LABELS.equipment}</option>
                        <option value="subcontract">{COST_TYPE_LABELS.subcontract}</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-unit`} className="text-xs">
                        Unité
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-unit`}
                        size="sm"
                        value={component.unit ?? ""}
                        onChange={(event) =>
                          updateComponent(index, { unit: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-quantity`} className="text-xs">
                        Quantité
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-quantity`}
                        size="sm"
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
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-unit-cost`} className="text-xs">
                        Coût unitaire HT
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-unit-cost`}
                        size="sm"
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

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-loss`} className="text-xs">
                        Pertes (bp)
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-loss`}
                        size="sm"
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
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-yield`} className="text-xs">
                        Rendement
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-yield`}
                        size="sm"
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
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-yield-unit`} className="text-xs">
                        Unité rendement
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-yield-unit`}
                        size="sm"
                        value={component.yieldUnit ?? ""}
                        onChange={(event) =>
                          updateComponent(index, { yieldUnit: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-confidence`} className="text-xs">
                        Confiance
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-confidence`}
                        size="sm"
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
                    <div className="space-y-1.5">
                      <p id={`${fieldId}-ds-label`} className="text-xs font-medium text-foreground">
                        DS composant
                      </p>
                      <output
                        aria-labelledby={`${fieldId}-ds-label`}
                        className="flex h-9 items-center rounded-control border border-border bg-surface-subtle px-3 text-sm text-foreground-secondary tabular-nums"
                      >
                        {formatCurrency(componentDsCents, "EUR")}
                      </output>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <StatementField
                      id={`${fieldId}-facts`}
                      label="Faits"
                      value={component.facts.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { facts: parseLines(value) })
                      }
                    />
                    <StatementField
                      id={`${fieldId}-hypotheses`}
                      label="Hypothèses"
                      value={component.hypotheses.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { hypotheses: parseLines(value) })
                      }
                    />
                    <StatementField
                      id={`${fieldId}-inferences`}
                      label="Inférences"
                      value={component.inferences.join("\n")}
                      onChange={(value) =>
                        updateComponent(index, { inferences: parseLines(value) })
                      }
                    />
                  </div>

                  {component.sources.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-border-subtle bg-surface-subtle p-3">
                      <p className="text-xs font-medium text-foreground-secondary">Provenance composée</p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {component.sources.map((source) => (
                          <li key={`${source.sourceFragmentId}-${source.evidenceKind}`}>
                            {EVIDENCE_KIND_LABELS[source.evidenceKind] ?? source.evidenceKind} · {source.sourceFragmentId}
                            {source.note ? ` · ${source.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="md" onClick={addComponent}>
          Ajouter un composant
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={
            isSaving ||
            components.every((component) => !component.designation.trim()) ||
            reviewStateIsCurrent
          }
        >
          {isSaving
            ? "Validation…"
            : reviewStateIsCurrent
              ? "Sous-détail déjà validé"
              : subdetail.status === "reviewed"
                ? "Revalider le sous-détail"
                : "Valider le sous-détail"}
        </Button>
      </div>
    </section>
  );
}

function StatementField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} className="text-xs">
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        className="min-h-28 px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
