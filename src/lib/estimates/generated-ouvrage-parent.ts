import { toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";

export function normalizeGeneratedOuvrageParent(input: {
  designation: string;
  unit: unknown;
  quantity: unknown;
}): { designation: string; unit: string | null; quantity: number | null } {
  const unit = typeof input.unit === "string" ? input.unit.trim() : "";
  return {
    designation: input.designation.trim().replace(/\s+/g, " ").slice(0, 500).trim(),
    unit: unit || null,
    quantity: typeof input.quantity === "number" && Number.isFinite(input.quantity)
      ? toStoredEstimateNumeric(input.quantity, 3)
      : null,
  };
}
