import { toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";

export type GeneratedOuvrageComponentContentInput = {
  readonly costType: "material" | "labor" | "equipment" | "subcontract";
  readonly designation: string;
  readonly unit?: string | null;
  readonly quantity: number;
  readonly unitCostHtCents: number;
  readonly lossCoeffBp: number;
  readonly yieldValue?: number | null;
  readonly yieldUnit?: string | null;
  readonly confidence: number;
  readonly sourceLabel?: string | null;
  readonly facts: readonly string[];
  readonly hypotheses: readonly string[];
  readonly inferences: readonly string[];
  readonly riskSignals: readonly {
    readonly label: string;
    readonly severity: "info" | "warning" | "critical";
    readonly basis: "fact" | "hypothesis" | "inference";
  }[];
  readonly sources: readonly {
    readonly sourceFragmentId: string;
    readonly evidenceKind: "fact" | "hypothesis" | "inference";
    readonly note?: string | null;
  }[];
};

function nullableText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizedText(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength).trim();
}

function normalizedStatements(values: readonly string[]) {
  return values.map((value) => normalizedText(value, 320)).filter((value) => value.length > 0);
}

export function normalizeGeneratedOuvrageComponentContent(component: GeneratedOuvrageComponentContentInput) {
  return {
    costType: component.costType,
    designation: normalizedText(component.designation, 500),
    unit: nullableText(component.unit),
    quantity: toStoredEstimateNumeric(component.quantity, 3),
    unitCostHtCents: component.unitCostHtCents,
    lossCoeffBp: component.lossCoeffBp,
    yieldValue: component.yieldValue == null ? null : toStoredEstimateNumeric(component.yieldValue, 3),
    yieldUnit: nullableText(component.yieldUnit),
    confidence: toStoredEstimateNumeric(component.confidence, 4),
    sourceLabel: nullableText(component.sourceLabel),
    facts: normalizedStatements(component.facts),
    hypotheses: normalizedStatements(component.hypotheses),
    inferences: normalizedStatements(component.inferences),
    riskSignals: component.riskSignals.map((signal) => ({ ...signal })),
    sources: component.sources.map((source) => ({
      sourceFragmentId: source.sourceFragmentId.toLowerCase(),
      evidenceKind: source.evidenceKind,
      note: nullableText(source.note),
    })),
  };
}

export function generatedOuvrageComponentContentJson(content: ReturnType<typeof normalizeGeneratedOuvrageComponentContent>) {
  return JSON.stringify(content, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  });
}
