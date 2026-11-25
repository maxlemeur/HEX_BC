"use client";

import { useSearchParams } from "next/navigation";

import { SupplierReferenceQueue } from "@/components/products/SupplierReferenceQueue";

/** The supplier references an import left « à vérifier », checked together (TI-711). */
export default function SupplierReferencesToReviewPage() {
  const searchParams = useSearchParams();
  return <SupplierReferenceQueue initialImportBatchId={searchParams.get("import_batch_id")} />;
}
