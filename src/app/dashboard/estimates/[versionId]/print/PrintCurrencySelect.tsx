import { NativeSelect } from "@/components/ui/native-select";
import { type SupportedEstimateCurrency } from "@/lib/money";

type PrintCurrencySelectProps = {
  currency: SupportedEstimateCurrency;
};

export function PrintCurrencySelect({ currency }: PrintCurrencySelectProps) {
  return (
    <NativeSelect aria-label="Devise" size="sm" wrapperClassName="w-24" defaultValue={currency} disabled>
      <option value={currency}>{currency}</option>
    </NativeSelect>
  );
}
