import { notFound } from "next/navigation";

import { DirectionDashboardPage } from "@/components/direction/DirectionDashboardPage";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchDirectionDashboardPageData,
  type DirectionDashboardPageData,
} from "@/lib/direction/server";
import {
  parseDirectionDashboardQuery,
} from "@/lib/direction/schemas";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Impossible de charger le cockpit direction.";
}

function logDirectionRoute(message: string) {
  console.log(`[direction-route] ${message}`);
}

export default async function DirectionDashboardRoute({ searchParams }: Props) {
  const [params, { profile, tenantId }] = await Promise.all([
    searchParams,
    getUserContext(),
  ]);

  if (!tenantId) {
    notFound();
  }

  const tenantRole = profile?.tenant_role ?? null;
  logDirectionRoute(
    `request tenant=${tenantId} role=${tenantRole ?? "none"}`
  );
  if (tenantRole !== "admin" && tenantRole !== "director") {
    notFound();
  }

  const query = parseDirectionDashboardQuery(params);
  let data: DirectionDashboardPageData;

  try {
    data = await fetchDirectionDashboardPageData(query);
  } catch (error) {
    logDirectionRoute(`failed message=${getSafeErrorMessage(error)}`);
    throw new Error(getSafeErrorMessage(error));
  }

  return (
    <DirectionDashboardPage
      data={data}
      initialQuery={query}
    />
  );
}
