import { multiplyToStoredEstimateNumeric, toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";

export type GeneratedOuvrageLaborHoursComponent = {
  readonly status: "suggested" | "manual" | "rejected";
  readonly unit: string | null;
  readonly quantity: number;
  readonly yieldValue: number | null;
  readonly yieldUnit: string | null;
};

export function deriveGeneratedOuvrageLaborHours(input: {
  component: GeneratedOuvrageLaborHoursComponent;
  parentQuantity: number;
}): {
  derivedHours: number;
  hoursSource: "quantity" | "yield";
} {
  const normalizedUnit = input.component.unit?.trim().toLowerCase();
  const normalizedYieldUnit = input.component.yieldUnit?.trim().toLowerCase();
  const quantity = toStoredEstimateNumeric(input.component.quantity, 3);
  const yieldValue = input.component.yieldValue === null
    ? null : toStoredEstimateNumeric(input.component.yieldValue, 3);
  const prefersExplicitQuantity =
    input.component.status === "manual" &&
    (!normalizedUnit || normalizedUnit === "h" || normalizedUnit.startsWith("h/"));

  if (prefersExplicitQuantity) {
    return { derivedHours: quantity, hoursSource: "quantity" };
  }
  if (
    yieldValue !== null && yieldValue > 0 &&
    normalizedYieldUnit?.startsWith("h/")
  ) {
    return {
      derivedHours: multiplyToStoredEstimateNumeric(toStoredEstimateNumeric(input.parentQuantity, 3), yieldValue, 3),
      hoursSource: "yield",
    };
  }
  return { derivedHours: quantity, hoursSource: "quantity" };
}
