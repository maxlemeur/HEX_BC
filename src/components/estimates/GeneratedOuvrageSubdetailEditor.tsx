"use client";

import { type ChangeEvent, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui-legacy/Toast";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/money";
import { MAX_CENTS } from "@/lib/estimate-calculations";
import { deriveGeneratedOuvrageLaborHours } from "@/lib/estimates/generated-ouvrage-labor-hours";
import { toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";
import { generatedOuvrageComponentContentJson, normalizeGeneratedOuvrageComponentContent } from "@/lib/estimates/generated-ouvrage-component-content";
import { cn } from "@/lib/utils";

import type {
  GeneratedOuvrageSubdetailEditorComponent,
} from "./generated-ouvrage-types";
import {
  GENERATED_OUVRAGE_NUMERIC_FIELDS,
  formatGeneratedOuvrageNumber,
  generatedOuvrageNumericDraft,
  parseGeneratedOuvrageNumber,
  type GeneratedOuvrageNumericDraft,
  type GeneratedOuvrageNumericField,
} from "./generated-ouvrage-number-entry";
import type {
  GeneratedOuvrageRiskSignal,
  GeneratedOuvrageSubdetailResult,
} from "@/lib/estimates/generated-ouvrages";

type GeneratedOuvrageSubdetailEditorProps = {
  candidateLabel: string;
  parentQuantity?: number;
  isReviewed?: boolean;
  subdetail: GeneratedOuvrageSubdetailResult;
  isSaving: boolean;
  onChange: () => void;
  onSave: (components: GeneratedOuvrageSubdetailEditorComponent[]) => Promise<void> | void;
};

type EditableComponent = GeneratedOuvrageSubdetailEditorComponent & {
  rejectedFromStatus: "suggested" | "manual" | null;
  localKey: string;
  numericDraft: GeneratedOuvrageNumericDraft;
  numericErrors: Partial<Record<GeneratedOuvrageNumericField, string>>;
};

function emptyComponent(): EditableComponent {
  return {
    componentId: null,
    localKey: crypto.randomUUID(),
    numericDraft: generatedOuvrageNumericDraft({ quantity: 1, unitCostHtCents: 0, lossCoeffBp: 0, yieldValue: null }),
    numericErrors: {},
    status: "manual",
    rejectedFromStatus: null,
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
): EditableComponent[] {
  return subdetail.components.map((component) => ({
    componentId: component.componentId,
    localKey: component.componentId,
    numericDraft: generatedOuvrageNumericDraft(component),
    numericErrors: {},
    status: component.status,
    rejectedFromStatus: component.rejectedFromStatus ?? null,
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
  return JSON.stringify(components.map((component) => ({
    componentId: component.componentId,
    status: component.status,
    restore: component.restore ?? false,
    restoreAsManual: component.restoreAsManual ?? false,
    content: generatedOuvrageComponentContentJson(normalizeGeneratedOuvrageComponentContent(component)),
  })));
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
  const content = normalizeGeneratedOuvrageComponentContent(component);
  return Math.round(
    content.quantity *
      content.unitCostHtCents *
      (1 + content.lossCoeffBp / 10_000)
  );
}

export function GeneratedOuvrageSubdetailEditor({
  subdetail,
  ...props
}: GeneratedOuvrageSubdetailEditorProps) {
  return (
    <GeneratedOuvrageSubdetailEditorForm
      key={`${subdetail.candidateId}:${subdetail.reviewToken}`}
      subdetail={subdetail}
      {...props}
    />
  );
}

function GeneratedOuvrageSubdetailEditorForm({
  candidateLabel,
  parentQuantity = 1,
  isReviewed = true,
  subdetail,
  isSaving,
  onChange,
  onSave,
}: GeneratedOuvrageSubdetailEditorProps) {
  const [components, setComponents] = useState<EditableComponent[]>(
    () => toEditableComponents(subdetail)
  );
  const [expandedComponentIndex, setExpandedComponentIndex] = useState(0);
  const formId = useId();
  const toast = useToast();

  const retainedComponents = components
    .filter((component) => component.status !== "rejected")
    .map((component) => ({ ...component, ...normalizeGeneratedOuvrageComponentContent(component) }));
  const dsCents = retainedComponents.reduce(
    (total, component) => total + computeComponentDsCents(component),
    0
  );
  const laborHours = (() => {
    try {
      return toStoredEstimateNumeric(retainedComponents.reduce((total, component) => total + (
        component.costType === "labor"
          ? deriveGeneratedOuvrageLaborHours({ component, parentQuantity }).derivedHours
          : 0
      ), 0), 3);
    } catch {
      return null;
    }
  })();
  const marginMultiplier =
    subdetail.summary.dsCents > 0
      ? subdetail.summary.indicativeTargetPriceCents / subdetail.summary.dsCents
      : 1;
  const indicativeTargetPriceCents = Math.round(dsCents * marginMultiplier);
  const hasInvalidDraft = components.some((component) =>
    component.status !== "rejected" && Object.keys(component.numericErrors).length > 0
  );
  const hasCostOverflow = !Number.isInteger(dsCents) || dsCents < 0 || dsCents > MAX_CENTS ||
    !Number.isInteger(indicativeTargetPriceCents) || indicativeTargetPriceCents < 0 || indicativeTargetPriceCents > MAX_CENTS;
  const reviewStateIsCurrent =
    !hasInvalidDraft && !hasCostOverflow &&
    laborHours !== null &&
    isReviewed &&
    subdetail.status === "reviewed" &&
    serializeComponents(components) ===
      serializeComponents(toEditableComponents(subdetail));

  function componentCalculationError(component: EditableComponent): string | null {
    try {
      const content = normalizeGeneratedOuvrageComponentContent(component);
      if (!Number.isInteger(content.unitCostHtCents) || content.unitCostHtCents < 0 || content.unitCostHtCents > MAX_CENTS ||
        !Number.isInteger(content.lossCoeffBp) || content.lossCoeffBp < 0 || content.lossCoeffBp > 100000 ||
        content.quantity < 0 || (content.yieldValue !== null && content.yieldValue <= 0)) {
        return "Les nombres saisis sont hors des limites autorisées.";
      }
      if (component.costType === "labor" && component.status !== "rejected") {
        deriveGeneratedOuvrageLaborHours({ component: { ...component, ...content }, parentQuantity });
      }
      const cost = computeComponentDsCents(component);
      if (!Number.isInteger(cost) || cost < 0 || (component.status !== "rejected" && cost > MAX_CENTS)) {
        return "Le coût calculé dépasse la limite autorisée. Corrigez le prix ou la quantité.";
      }
      return null;
    } catch {
      return "Quantité ou rendement invalide (maximum 999999999.999).";
    }
  }

  function canCalculateComponent(component: EditableComponent) {
    if (Object.keys(component.numericErrors).length > 0) return false;
    const error = componentCalculationError(component);
    if (error) {
      toast.error({ title: error });
      return false;
    }
    return true;
  }

  function updateComponent(
    index: number,
    patch: Partial<GeneratedOuvrageSubdetailEditorComponent>,
    numericField?: GeneratedOuvrageNumericField,
    rawText?: string
  ) {
    if (components[index]?.status === "rejected") return;
    const current = components[index];
    if (!current) return;
    const draft = numericField === undefined ? current : {
      ...current,
      numericDraft: { ...current.numericDraft, [numericField]: rawText ?? "" },
      numericErrors: { ...current.numericErrors },
    };
    const next = { ...draft, ...patch };
    try {
      normalizeGeneratedOuvrageComponentContent(next);
    } catch {
      if (numericField !== undefined) {
        draft.numericErrors[numericField] = "Quantité ou rendement invalide (maximum 999999999.999).";
        onChange();
        setComponents(components.map((component, componentIndex) => componentIndex === index ? draft : component));
      } else toast.error({ title: "Quantité ou rendement invalide (maximum 999999999.999)." });
      return;
    }
    const baseline = toEditableComponents(subdetail).find((component) => component.componentId === current.componentId);
    const content = (component: EditableComponent) => generatedOuvrageComponentContentJson(
      normalizeGeneratedOuvrageComponentContent(component)
    );
    const origin = baseline?.status === "rejected" ? baseline.rejectedFromStatus ?? "manual" : baseline?.status ?? "manual";
    next.status = baseline && content(next) === content(baseline) ? origin : "manual";
    const error = componentCalculationError(next);
    if (error) {
      if (numericField !== undefined) {
        draft.numericErrors[numericField] = error;
        onChange();
        setComponents(components.map((component, componentIndex) => componentIndex === index ? draft : component));
      } else toast.error({ title: error });
      return;
    }
    if (numericField !== undefined) delete next.numericErrors[numericField];
    if (next.status !== current.status || content(next) !== content(current)) onChange();
    setComponents(components.map((component, componentIndex) => componentIndex === index ? next : component));
  }

  function updateNumber(index: number, field: GeneratedOuvrageNumericField, text: string) {
    const current = components[index];
    if (!current || current.status === "rejected") return;
    const parsed = parseGeneratedOuvrageNumber(field, text);
    if ("error" in parsed) {
      onChange();
      setComponents(components.map((component, componentIndex) => componentIndex === index ? {
        ...component, numericDraft: { ...component.numericDraft, [field]: text },
        numericErrors: { ...component.numericErrors, [field]: parsed.error },
      } : component));
      return;
    }
    updateComponent(index, { [field]: parsed.value }, field, text);
  }

  function numberInputProps(index: number, field: GeneratedOuvrageNumericField, fieldId: string) {
    const component = components[index];
    const error = component.numericErrors[field];
    return {
      value: component.numericDraft[field],
      inputMode: "decimal" as const,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? fieldId + "-" + field + "-error" : undefined,
      onChange: (event: ChangeEvent<HTMLInputElement>) => updateNumber(index, field, event.target.value),
      onBlur: () => {
        if (error || component.status === "rejected") return;
        setComponents((previous) => previous.map((entry) => entry.localKey === component.localKey ? {
          ...entry, numericDraft: { ...entry.numericDraft, [field]: formatGeneratedOuvrageNumber(field, entry[field]) },
        } : entry));
      },
    };
  }

  function numberError(component: EditableComponent, field: GeneratedOuvrageNumericField, fieldId: string) {
    const error = component.numericErrors[field];
    return error ? <p id={fieldId + "-" + field + "-error"} className="text-xs text-danger" role="alert">
      {error}{component.status === "rejected" ? " Ce composant est écarté ; sa dernière valeur valide sera conservée." : ""}
    </p> : null;
  }

  function resetNumberDrafts(component: EditableComponent, fields: GeneratedOuvrageNumericField[]): EditableComponent {
    return { ...component, numericDraft: { ...component.numericDraft,
      ...Object.fromEntries(fields.map((field) => [field, formatGeneratedOuvrageNumber(field, component[field])])),
    } };
  }

  function toggleComponent(index: number) {
    onChange();
    setComponents((prev) => prev.map((component, componentIndex) => {
      if (componentIndex !== index) return component;
      if (component.status !== "rejected") {
        return { ...component, status: "rejected", rejectedFromStatus: component.status };
      }
      const stored = subdetail.components.find((entry) => entry.componentId === component.componentId);
      const persistedRejection = stored?.status === "rejected";
      return {
        ...component,
        status: component.rejectedFromStatus ?? "manual",
        ...(persistedRejection && stored.rejectedFromStatus ? { restore: true } : {}),
        ...(persistedRejection && !stored.rejectedFromStatus ? { restoreAsManual: true } : {}),
      };
    }));
  }

  function addComponent() {
    onChange();
    setComponents((prev) => [...prev, emptyComponent()]);
    setExpandedComponentIndex(components.length);
  }

  function removeComponent(index: number) {
    if (components[index]?.componentId || components[index]?.status === "rejected") return;
    onChange();
    setComponents((prev) => prev.filter((_, componentIndex) => componentIndex !== index));
    setExpandedComponentIndex((current) => {
      if (current === index) return Math.max(index - 1, 0);
      if (current > index) return current - 1;
      return current;
    });
  }

  function duplicateComponent(index: number) {
    if (components[index]?.status === "rejected") return;
    const original = components[index];
    if (!original || !canCalculateComponent(original)) return;
    onChange();
    setComponents((prev) => {
      const component = prev[index];
      if (!component) return prev;
      return [
        ...prev.slice(0, index + 1),
        { ...component, componentId: null, localKey: crypto.randomUUID(), numericDraft: generatedOuvrageNumericDraft(component),
          status: "manual", rejectedFromStatus: null, restore: undefined, restoreAsManual: undefined },
        ...prev.slice(index + 1),
      ];
    });
    setExpandedComponentIndex(index + 1);
  }

  function splitComponent(index: number) {
    if (components[index]?.status === "rejected") return;
    const prev = components;
    const component = prev[index];
    if (!component) return;
    if (!canCalculateComponent(component)) return;
    const firstHalf = Number((component.quantity / 2).toFixed(3));
    const secondHalf = Number((component.quantity - firstHalf).toFixed(3));
    if (firstHalf <= 0 || secondHalf <= 0) return;
    const first = { ...component, quantity: firstHalf, status: "manual" as const };
    const second = { ...component, componentId: null, localKey: crypto.randomUUID(), quantity: secondHalf, status: "manual" as const,
      rejectedFromStatus: null, restore: undefined, restoreAsManual: undefined, sourceLabel: "Scission manuelle" };
    if (component.costType === "labor") {
      const hours = deriveGeneratedOuvrageLaborHours({ component, parentQuantity }).derivedHours;
      if (parentQuantity > 0) {
        first.yieldValue = Number((hours * firstHalf / component.quantity / parentQuantity).toFixed(3));
        second.yieldValue = Number((hours / parentQuantity - first.yieldValue).toFixed(3));
        first.yieldUnit = second.yieldUnit = "h/u";
      }
      if (!canCalculateComponent(first) || !canCalculateComponent(second)) return;
      const splitHours = deriveGeneratedOuvrageLaborHours({ component: first, parentQuantity }).derivedHours +
        deriveGeneratedOuvrageLaborHours({ component: second, parentQuantity }).derivedHours;
      if (splitHours !== hours) return;
    }
    if (computeComponentDsCents(first) + computeComponentDsCents(second) !== computeComponentDsCents(component)) return;
    const next = [
      ...prev.slice(0, index),
      resetNumberDrafts(first, component.costType === "labor" ? ["quantity", "yieldValue"] : ["quantity"]),
      resetNumberDrafts(second, component.costType === "labor" ? ["quantity", "yieldValue"] : ["quantity"]),
      ...prev.slice(index + 1),
    ];
    onChange();
    setComponents(next);
    setExpandedComponentIndex(index + 1);
  }

  function mergeWithPrevious(index: number) {
    if (index === 0) return;
    const prev = components;
    const current = prev[index];
    const previous = prev[index - 1];
    if (!current || !previous || current.status === "rejected" || previous.status === "rejected" ||
      current.costType !== previous.costType || current.unit !== previous.unit ||
      current.unitCostHtCents !== previous.unitCostHtCents || current.lossCoeffBp !== previous.lossCoeffBp ||
      current.yieldValue !== previous.yieldValue || current.yieldUnit !== previous.yieldUnit) {
      return;
    }

    if (!canCalculateComponent(current) || !canCalculateComponent(previous)) return;

    const merged: EditableComponent = {
      ...previous,
      status: "manual",
      quantity: Number((previous.quantity + current.quantity).toFixed(3)),
      designation:
        previous.designation === current.designation
          ? previous.designation
          : `${previous.designation} + ${current.designation}`,
      facts: Array.from(new Set([...previous.facts, ...current.facts])),
      hypotheses: Array.from(
        new Set([...previous.hypotheses, ...current.hypotheses])
      ),
      inferences: Array.from(
        new Set([...previous.inferences, ...current.inferences])
      ),
      riskSignals: Array.from(
        new Map(
          [...previous.riskSignals, ...current.riskSignals].map((signal) => [
            `${signal.severity}:${signal.basis}:${signal.label}`,
            signal,
          ])
        ).values()
      ),
      sources: Array.from(new Map([...previous.sources, ...current.sources].map((source) =>
        [JSON.stringify(source), source])).values()),
    };

    if (!canCalculateComponent(merged)) return;
    if ([merged.facts, merged.hypotheses, merged.inferences, merged.riskSignals].some((values) => values.length > 8) ||
      merged.sources.length > 6 ||
      computeComponentDsCents(merged) !== computeComponentDsCents(previous) + computeComponentDsCents(current)) return;
    if (merged.costType === "labor") {
      const hours = deriveGeneratedOuvrageLaborHours({ component: previous, parentQuantity }).derivedHours +
        deriveGeneratedOuvrageLaborHours({ component: current, parentQuantity }).derivedHours;
      if (parentQuantity > 0) {
        merged.yieldValue = Number((hours / parentQuantity).toFixed(3));
        merged.yieldUnit = "h/u";
      }
      if (!canCalculateComponent(merged)) return;
      if (deriveGeneratedOuvrageLaborHours({ component: merged, parentQuantity }).derivedHours !== hours) return;
    }

    const next = [
      ...prev.slice(0, index - 1),
      resetNumberDrafts(merged, merged.costType === "labor" ? ["quantity", "yieldValue"] : ["quantity"]),
      ...(current.componentId ? [{ ...current, status: "rejected" as const, rejectedFromStatus: current.status }] : []),
      ...prev.slice(index + 1),
    ];
    onChange();
    setComponents(next);
    setExpandedComponentIndex(index - 1);
  }

  async function handleSave() {
    if (isSaving || laborHours === null || hasCostOverflow || components.some((component) => {
      if (componentCalculationError(component)) return true;
      return component.status !== "rejected" && (Object.keys(component.numericErrors).length > 0 ||
        GENERATED_OUVRAGE_NUMERIC_FIELDS.some((field) => "error" in parseGeneratedOuvrageNumber(field, component.numericDraft[field])));
    })) return;
    const sanitized = components
      .map(({ rejectedFromStatus, localKey, numericDraft, numericErrors, ...component }) => {
        void rejectedFromStatus;
        void localKey;
        void numericDraft;
        void numericErrors;
        return {
        ...component,
        designation: component.designation.trim(),
        unit: component.unit?.trim() || null,
        yieldUnit: component.yieldUnit?.trim() || null,
        sourceLabel: component.sourceLabel?.trim() || null,
        };
      })
      .filter((component) => component.designation.length > 0);

    await onSave(sanitized);
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface-subtle p-4">
      <fieldset disabled={isSaving} className="min-w-0">
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
            {retainedComponents.length === components.length
              ? `${components.length} composant(s)`
              : `${retainedComponents.length} retenu(s) sur ${components.length}`}
          </Badge>
          <Badge variant="info" size="sm">
            DS {hasCostOverflow ? "à corriger" : formatCurrency(dsCents, "EUR")}
          </Badge>
          <Badge variant="success" size="sm">
            Prix cible {hasCostOverflow ? "à corriger" : formatCurrency(indicativeTargetPriceCents, "EUR")}
          </Badge>
          <Badge variant="neutral" size="sm">MO {laborHours === null ? "à corriger" : `${laborHours} h`}</Badge>
          <Badge variant={reviewStateIsCurrent ? "success" : "warning"} size="sm">
            {reviewStateIsCurrent ? "Revu" : "À revoir"}
          </Badge>
        </div>
      </div>

      {laborHours === null ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          Les heures calculées dépassent la limite de stockage. Corrigez la quantité ou le rendement avant validation.
        </p>
      ) : null}

      {hasCostOverflow ? <p role="alert" className="mt-3 text-sm text-danger">
        Le coût ou le prix cible calculé dépasse la limite autorisée. Corrigez la composition avant validation.
      </p> : null}

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
          const isRejected = component.status === "rejected";

          return (
            <article
              key={component.localKey}
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
                      variant={isRejected ? "danger" : component.status === "manual" ? "warning" : "neutral"}
                      size="sm"
                    >
                      {isRejected ? "Écarté" : component.status === "manual" ? "Saisi manuellement" : "Suggéré"}
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
                    <Button type="button" variant="secondary" size="xs" onClick={() => toggleComponent(index)}>
                      {isRejected ? component.rejectedFromStatus ? "Rétablir" : "Rétablir comme saisie manuelle" : "Écarter"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => duplicateComponent(index)}
                      disabled={isRejected || Object.keys(component.numericErrors).length > 0}
                    >
                      Dupliquer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => splitComponent(index)}
                      disabled={isRejected || Object.keys(component.numericErrors).length > 0}
                    >
                      Scinder
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => mergeWithPrevious(index)}
                      disabled={isRejected || Object.keys(component.numericErrors).length > 0 || index === 0 ||
                        components[index - 1]?.status === "rejected" || Object.keys(components[index - 1]?.numericErrors ?? {}).length > 0}
                    >
                      Fusionner
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-danger hover:bg-danger-subtle hover:text-danger"
                      onClick={() => removeComponent(index)}
                      disabled={isRejected || !!component.componentId || components.length === 1}
                      title={component.componentId ? "La proposition est conservée. Utilisez Écarter." : undefined}
                    >
                      Supprimer
                    </Button>
                  </div>

                  <fieldset disabled={isRejected} className="min-w-0">
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
                        {...numberInputProps(index, "quantity", fieldId)}
                      />
                      {numberError(component, "quantity", fieldId)}
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-unit-cost`} className="text-xs">
                        Coût unitaire HT (€)
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-unit-cost`}
                        size="sm"
                        {...numberInputProps(index, "unitCostHtCents", fieldId)}
                      />
                      {numberError(component, "unitCostHtCents", fieldId)}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-loss`} className="text-xs">
                        Pertes (%)
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-loss`}
                        size="sm"
                        {...numberInputProps(index, "lossCoeffBp", fieldId)}
                      />
                      {numberError(component, "lossCoeffBp", fieldId)}
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor={`${fieldId}-yield`} className="text-xs">
                        Rendement
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-yield`}
                        size="sm"
                        {...numberInputProps(index, "yieldValue", fieldId)}
                      />
                      {numberError(component, "yieldValue", fieldId)}
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

                  </fieldset>
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
            hasInvalidDraft || hasCostOverflow ||
            laborHours === null ||
            components.every((component) => !component.designation.trim()) ||
            reviewStateIsCurrent
          }
        >
          {isSaving
            ? "Validation…"
            : retainedComponents.length === 0
              ? "Enregistrer les décisions"
            : reviewStateIsCurrent
              ? "Sous-détail déjà validé"
              : subdetail.status === "reviewed"
                ? "Revalider le sous-détail"
                : "Valider le sous-détail"}
        </Button>
      </div>
      </fieldset>
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
