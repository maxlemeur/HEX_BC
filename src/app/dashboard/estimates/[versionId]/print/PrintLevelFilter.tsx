"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { NativeSelect } from "@/components/ui/native-select";

type PrintLevelFilterProps = {
  value: "all" | "1" | "2" | "3" | "4";
};

export function PrintLevelFilter({ value }: PrintLevelFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <NativeSelect
      aria-label="Niveau maximal affiché"
      size="sm"
      wrapperClassName="w-44"
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
    </NativeSelect>
  );
}

