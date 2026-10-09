import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function DashboardOrdersLoading() {
  return <PageSkeleton variant="list" label="Chargement des bons de commande…" />;
}
