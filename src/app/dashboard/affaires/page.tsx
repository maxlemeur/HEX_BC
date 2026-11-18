import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { lastAffaireCookieName } from "@/lib/navigation/last-affaire";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

import { fetchAffairePageData, findReadableAffaireProject } from "@/lib/affaires/server";
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
  if (params.reprendre === "metre") {
    const { tenantId } = await getUserContext();
    if (!tenantId) redirect("/dashboard/affaires");
    const context = await getAuthenticatedContext();
    const saved = (await cookies()).get(lastAffaireCookieName(context.userId, context.tenantId));
    const id = z.uuid().safeParse(saved?.value);
    if (id.success && await isTakeoffEnabled(context.tenantId) && await findReadableAffaireProject(context, id.data)) {
      redirect(`/dashboard/affaires/${id.data}/takeoff`);
    }
    redirect("/dashboard/affaires");
  }
  const query = parseAffaireListQuery(params);

  return (
    <Suspense fallback={<AffairesLoading />}>
      <AffairesPageResults query={query} />
    </Suspense>
  );
}
