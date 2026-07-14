import { type SupportedEstimateCurrency } from "@/lib/money";

type PrintCurrencySelectProps = {
  currency: SupportedEstimateCurrency;
};

export function PrintCurrencySelect({ currency }: PrintCurrencySelectProps) {
  return (
    <label>
      <span className="sr-only">Devise</span>
      <select
        aria-label="Devise"
        className="form-input form-select h-10 w-24 bg-white text-sm font-medium"
        defaultValue={currency}
        disabled
      >
        <option value={currency}>{currency}</option>
      </select>
    </label>
  );
}
