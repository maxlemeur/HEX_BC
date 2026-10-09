import { PricesManager } from "@/components/catalogue/PricesManager";

export default async function DashboardPricesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ product_id?: string }>;
}>) {
  const { product_id: productId } = await searchParams;

  return (
    <div className="animate-fade-in">
      <PricesManager productId={productId ?? null} />
    </div>
  );
}
