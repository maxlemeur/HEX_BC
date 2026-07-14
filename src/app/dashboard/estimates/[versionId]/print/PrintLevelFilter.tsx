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
    <label>
      <span className="sr-only">Niveau max affiché</span>
      <select
        aria-label="Niveau max affiché"
        className="form-input form-select h-10 w-44 bg-white text-sm font-medium"
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
        <option value="all">Tous les niveaux</option>
        <option value="1">Jusqu&apos;au niveau 1</option>
        <option value="2">Jusqu&apos;au niveau 2</option>
        <option value="3">Jusqu&apos;au niveau 3</option>
        <option value="4">Jusqu&apos;au niveau 4</option>
      </select>
    </label>
  );
}

