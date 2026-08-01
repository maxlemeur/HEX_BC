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
}: Readonly<{
  query: NormalizedAffaireListQuery;
}>) {
  const data = await fetchAffairePageData({
    q: query.q,
    status: query.status,
    favorites: query.favoritesOnly,
    manager: query.manager,
    size: query.size,
    cursor: query.cursor,
    sort: query.sort,
    dir: query.dir,
  });

  return (
    <AffairesPageClient
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

  return (
    <Suspense fallback={<AffairesLoading />}>
      <AffairesPageResults query={query} />
    </Suspense>
  );
}
