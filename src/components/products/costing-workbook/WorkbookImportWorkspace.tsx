"use client";

import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";

import { CostingWorkbookImport } from "@/components/products/CostingWorkbookImport";
import { ImportBatchesPanel } from "@/components/products/costing-workbook/ImportBatchesPanel";

const CATALOGUE_PATH = "/dashboard/products";

export default function WorkbookImportWorkspace({ visible = true }: { visible?: boolean }) {
  const searchParams = useSearchParams();
  const { mutate } = useSWRConfig();
  const [imports, setImports] = useState(0);
  const query = searchParams.toString();
  const [lastQuery, setLastQuery] = useState(query);
  useEffect(() => {
    if (visible) setLastQuery(query);
  }, [query, visible]);
  const catalogueQuery = new URLSearchParams(visible ? query : lastQuery);
  catalogueQuery.delete("product_id");

  const draftsQuery = new URLSearchParams({ catalogue_status: "draft" });
  for (const key of ["size", "sort", "dir"]) {
    const value = catalogueQuery.get(key);
    if (value) draftsQuery.set(key, value);
  }
  const draftsHref = `${CATALOGUE_PATH}?${draftsQuery}`;
  // The catalogue is unmounted here. Clear cached pages so the return loads the new data.
  const clearCataloguePages = async () => {
    await mutate((key) => typeof key === "string" && key.startsWith("/api/catalogue?view=page&"), undefined, { revalidate: false });
  };

  return (
    <>
      <CostingWorkbookImport
        catalogueHref={catalogueQuery.size ? `${CATALOGUE_PATH}?${catalogueQuery}` : CATALOGUE_PATH}
        draftsHref={draftsHref}
        visible={visible}
        onImported={clearCataloguePages}
        onImportRecorded={() => setImports((count) => count + 1)}
      />
      <ImportBatchesPanel refreshKey={imports} draftsHref={draftsHref} onChanged={clearCataloguePages} />
    </>
  );
}
