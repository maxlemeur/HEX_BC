import { Suspense } from "react";

import { fetchAffairePageData } from "@/lib/affaires/server";
import {
  parseAffaireListQuery,
  type NormalizedAffaireListQuery,
} from "@/lib/affaires/schemas";
import { AffairesPageClient } from "@/components/affaires/AffairesPageClient";
import AffairesLoading from "./loading";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function AffairesPageResults({
  query,
  pageClientKey,
}: Readonly<{
  query: NormalizedAffaireListQuery;
  pageClientKey: string;
}>) {
  const data = await fetchAffairePageData(query);

  return (
    <AffairesPageClient
      key={pageClientKey}
      initialData={data}
      initialQ={query.q ?? ""}
      initialStatuses={query.status ?? []}
      initialFavoritesOnly={query.favoritesOnly}
      initialManager={query.manager}
      initialCursor={query.cursor}
      initialSize={query.size}
      initialSort={query.sort}
      initialDir={query.dir}
    />
  );
}

export default async function AffairesPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseAffaireListQuery(params);
  const pageClientKey = [
    query.q ?? "",
    (query.status ?? []).join(","),
    query.favoritesOnly ? "1" : "0",
    query.manager,
    query.cursor ?? "",
    String(query.size),
    query.dir,
  ].join("::");

  return (
    <Suspense key={pageClientKey} fallback={<AffairesLoading />}>
      <AffairesPageResults query={query} pageClientKey={pageClientKey} />
    </Suspense>
  );
}
