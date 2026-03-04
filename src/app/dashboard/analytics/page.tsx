import { fetchChiffreurAnalytics } from "@/lib/analytics/server";
import { ChiffreurDashboard } from "@/components/analytics/ChiffreurDashboard";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AnalyticsPage({ searchParams }: Props) {
  const params = await searchParams;

  // Parse owner filter: ?owner=all | ?owner=<uuid> | absent
  const ownerParam =
    typeof params.owner === "string" ? params.owner : undefined;

  // owner=all  -> { ownerUserId: null } (admin all scope)
  // owner=uuid -> { ownerUserId: uuid }
  // absent     -> undefined (backend default: admin=all, non-admin=self)
  const input =
    ownerParam === "all"
      ? { ownerUserId: null }
      : ownerParam
        ? { ownerUserId: ownerParam }
        : undefined;

  const data = await fetchChiffreurAnalytics(input);

  return <ChiffreurDashboard initialData={data} />;
}
