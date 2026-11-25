"use client";

import { useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";

import { CostingWorkbookImport } from "@/components/products/CostingWorkbookImport";

const CATALOGUE_PATH = "/dashboard/products";

export default function ImportCostingWorkbookPage() {
  const searchParams = useSearchParams();
  const { mutate } = useSWRConfig();
  const catalogueQuery = new URLSearchParams(searchParams.toString());
  catalogueQuery.delete("product_id");

  const draftsQuery = new URLSearchParams({ catalogue_status: "draft" });
  for (const key of ["size", "sort", "dir"]) {
    const value = catalogueQuery.get(key);
    if (value) draftsQuery.set(key, value);
  }

  return (
    <CostingWorkbookImport
      catalogueHref={catalogueQuery.size ? `${CATALOGUE_PATH}?${catalogueQuery}` : CATALOGUE_PATH}
      draftsHref={`${CATALOGUE_PATH}?${draftsQuery}`}
      onImported={async () => {
        // The catalogue is unmounted here. Clear cached pages so the return loads the new data.
        await mutate((key) => typeof key === "string" && key.startsWith("/api/catalogue?view=page&"), undefined, {
          revalidate: false,
        });
      }}
    />
  );
}
