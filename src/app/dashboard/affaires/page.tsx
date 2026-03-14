import { Suspense } from "react";

import {
  fetchAffaireManagerQueueSummary,
  fetchAffairePageData,
} from "@/lib/affaires/server";
import { parseAffaireListQuery } from "@/lib/affaires/schemas";
import { AffairesPageClient } from "@/components/affaires/AffairesPageClient";
import AffairesLoading from "./loading";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffairesPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseAffaireListQuery(params);

  const [data, managerQueueResult] = await Promise.all([
    fetchAffairePageData(query),
    query.manager === "all"
      ? fetchAffaireManagerQueueSummary({
          q: query.q ?? undefined,
          status: query.status,
          favorites: query.favoritesOnly,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const initialData =
    data.managerQueue || managerQueueResult === null
      ? data
      : {
          ...data,
          managerQueue: managerQueueResult,
        };
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
    <Suspense fallback={<AffairesLoading />}>
      <AffairesPageClient
        key={pageClientKey}
        initialData={initialData}
        initialQ={query.q ?? ""}
        initialStatuses={query.status ?? []}
        initialFavoritesOnly={query.favoritesOnly}
        initialManager={query.manager}
        initialCursor={query.cursor}
        initialSize={query.size}
        initialDir={query.dir}
      />
    </Suspense>
  );
}
