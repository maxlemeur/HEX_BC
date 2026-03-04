import { Suspense } from "react";

import { fetchAffairePageData } from "@/lib/affaires/server";
import { parseAffaireListQuery } from "@/lib/affaires/schemas";
import { AffairesPageClient } from "@/components/affaires/AffairesPageClient";
import AffairesLoading from "./loading";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffairesPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseAffaireListQuery(params);

  const data = await fetchAffairePageData(query);

  return (
    <Suspense fallback={<AffairesLoading />}>
      <AffairesPageClient
        initialData={data}
        initialQ={query.q ?? ""}
        initialStatuses={query.status ?? []}
        initialCursor={query.cursor}
        initialSize={query.size}
      />
    </Suspense>
  );
}
