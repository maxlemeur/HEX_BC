import { type SupportedEstimateCurrency } from "@/lib/money";

type PrintCurrencySelectProps = {
  currency: SupportedEstimateCurrency;
};

export function PrintCurrencySelect({ currency }: PrintCurrencySelectProps) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-[var(--slate-700)]">
      Devise
      <select className="form-input form-select h-9 w-24" defaultValue={currency} disabled>
        <option value={currency}>{currency}</option>
      </select>
    </label>
  );
}
