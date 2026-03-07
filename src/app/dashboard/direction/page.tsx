import { DirectionDashboardPage } from "@/components/direction/DirectionDashboardPage";
import {
  fetchDirectionDashboardPageData,
} from "@/lib/direction/server";
import {
  parseDirectionDashboardQuery,
} from "@/lib/direction/schemas";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DirectionDashboardRoute({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseDirectionDashboardQuery(params);
  const data = await fetchDirectionDashboardPageData(query);

  return (
    <DirectionDashboardPage
      data={data}
      initialQuery={query}
    />
  );
}
