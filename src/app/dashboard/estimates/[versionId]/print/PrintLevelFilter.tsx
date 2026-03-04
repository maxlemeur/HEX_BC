"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type PrintLevelFilterProps = {
  value: "all" | "1" | "2" | "3" | "4";
};

export function PrintLevelFilter({ value }: PrintLevelFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-[var(--slate-700)]">
      Niveau max affiché
      <select
        className="form-input form-select h-9 w-24"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          const params = new URLSearchParams(searchParams.toString());
          if (nextValue === "all") {
            params.delete("max_level");
          } else {
            params.set("max_level", nextValue);
          }
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname, {
            scroll: false,
          });
        }}
      >
        <option value="all">Tous</option>
        <option value="1">Niv. 1</option>
        <option value="2">Niv. 2</option>
        <option value="3">Niv. 3</option>
        <option value="4">Niv. 4</option>
      </select>
    </label>
  );
}

