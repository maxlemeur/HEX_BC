"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  SUPPORTED_ESTIMATE_CURRENCIES,
  type SupportedEstimateCurrency,
} from "@/lib/money";

type PrintCurrencySelectProps = {
  currency: SupportedEstimateCurrency;
};

export function PrintCurrencySelect({ currency }: PrintCurrencySelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-[var(--slate-700)]">
      Devise
      <select
        className="form-input form-select h-9 w-24"
        value={currency}
        onChange={(event) => {
          const nextCurrency = event.target.value as SupportedEstimateCurrency;
          const nextParams = new URLSearchParams(searchParams.toString());
          nextParams.set("currency", nextCurrency);
          const queryString = nextParams.toString();
          router.replace(
            queryString.length > 0 ? `${pathname}?${queryString}` : pathname,
            { scroll: false }
          );
        }}
      >
        {SUPPORTED_ESTIMATE_CURRENCIES.map((itemCurrency) => (
          <option key={itemCurrency} value={itemCurrency}>
            {itemCurrency}
          </option>
        ))}
      </select>
    </label>
  );
}
