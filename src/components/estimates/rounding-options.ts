import type { RoundingMode } from "@/lib/estimate-calculations";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

type RoundingOption = {
  label: string;
  value: string;
  mode: RoundingMode;
  step: number;
  preserved?: boolean;
};

/** New choices round down. Existing settings remain visible until explicitly changed. */
export function getCommercialRoundingOptions(
  currency: SupportedEstimateCurrency,
  mode: RoundingMode,
  step: number,
): { options: RoundingOption[]; value: string } {
  const options: RoundingOption[] = [
    { label: "Aucun", value: "none", mode: "none", step: 1 },
    ...[100, 1000, 5000, 10000].map((amount) => ({
      label: `${formatCurrency(amount, currency)} — palier inférieur`,
      value: String(amount),
      mode: "down" as const,
      step: amount,
    })),
  ];
  if (mode === "none") return { options, value: "none" };
  const selected = options.find((option) => option.mode === mode && option.step === step);
  if (selected) return { options, value: selected.value };

  const direction = mode === "nearest"
    ? "au plus proche"
    : mode === "up" ? "au palier supérieur" : "au palier inférieur";
  const value = `preserved-${mode}-${step}`;
  options.push({
    label: `Réglage conservé : ${direction}, pas de ${formatCurrency(step, currency)}`,
    value, mode, step, preserved: true,
  });
  return { options, value };
}
