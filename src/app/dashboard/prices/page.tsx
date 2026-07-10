import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { PricesManager } from "@/components/catalogue/PricesManager";

export default async function DashboardPricesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ product_id?: string }>;
}>) {
  const { product_id: productId } = await searchParams;

  return (
    <div className="animate-fade-in">
      <HubBreadcrumb hubHref="/dashboard/tarifs" hubLabel="Tarifs" currentLabel="Prix fournisseurs" />
      <PricesManager productId={productId ?? null} />
    </div>
  );
}
