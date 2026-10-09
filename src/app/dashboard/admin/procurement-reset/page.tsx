import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Trash2Icon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getUserContext } from "@/lib/auth/server";
import {
  drainProcurementStorageCleanupOutbox,
  type ProcurementStorageCleanupDrainResult,
} from "@/lib/procurement/storage-cleanup-outbox";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type ProcurementResetPageProps = {
  searchParams: SearchParams;
};

type ProcurementCounts = {
  orders: number;
  orderItems: number;
  orderDocuments: number;
  suppliers: number;
  supplierPrices: number;
};

const ORDER_STATUS_BADGES: Record<
  string,
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  draft: { label: "Brouillon", variant: "neutral" },
  sent: { label: "Envoyée", variant: "info" },
  confirmed: { label: "Confirmée", variant: "brand" },
  received: { label: "Reçue", variant: "success" },
  canceled: { label: "Annulée", variant: "danger" },
};

type ProcurementResetResult = {
  orders_deleted: number;
  supplier_prices_deleted: number;
  supplier_catalog_items_deleted: number;
  suppliers_deleted: number;
  storage_cleanup_queued: number;
};

async function requireAdminTenant() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return { tenantId };
}

async function countTenantRows(
  table:
    | "purchase_orders"
    | "purchase_order_items"
    | "suppliers"
    | "supplier_pricebook",
  tenantId: string
) {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function countTenantOrderDocuments(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("purchase_order_devis")
    .select("id, purchase_orders!inner(tenant_id)", {
      count: "exact",
      head: true,
    })
    .eq("purchase_orders.tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function loadProcurementCounts(tenantId: string): Promise<ProcurementCounts> {
  const [
    orders,
    orderItems,
    orderDocuments,
    suppliers,
    supplierPrices,
  ] = await Promise.all([
    countTenantRows("purchase_orders", tenantId),
    countTenantRows("purchase_order_items", tenantId),
    countTenantOrderDocuments(tenantId),
    countTenantRows("suppliers", tenantId),
    countTenantRows("supplier_pricebook", tenantId),
  ]);

  return {
    orders,
    orderItems,
    orderDocuments,
    suppliers,
    supplierPrices,
  };
}

async function loadPreviewRows(tenantId: string) {
  const supabase = await createSupabaseServerClient();

  const [ordersResult, suppliersResult] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("reference, status, total_ht_cents, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("suppliers")
      .select("name, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (ordersResult.error) {
    throw new Error(ordersResult.error.message);
  }
  if (suppliersResult.error) {
    throw new Error(suppliersResult.error.message);
  }

  return {
    orders: ordersResult.data ?? [],
    suppliers: suppliersResult.data ?? [],
  };
}

function buildQuery(params: Record<string, string | number>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function parseProcurementResetResult(value: unknown): ProcurementResetResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La base n'a pas renvoyé le bilan du nettoyage des achats.");
  }

  const record = value as Record<string, unknown>;
  const readCount = (key: keyof ProcurementResetResult) => {
    const count = record[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error("Le bilan du nettoyage des achats est invalide.");
    }
    return count;
  };

  return {
    orders_deleted: readCount("orders_deleted"),
    supplier_prices_deleted: readCount("supplier_prices_deleted"),
    supplier_catalog_items_deleted: readCount(
      "supplier_catalog_items_deleted"
    ),
    suppliers_deleted: readCount("suppliers_deleted"),
    storage_cleanup_queued: readCount("storage_cleanup_queued"),
  };
}

async function resetTenantProcurementData(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reset_tenant_procurement_data", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return parseProcurementResetResult(data);
}

async function resetProcurementData(formData: FormData) {
  "use server";

  const confirmation = String(formData.get("confirmation") ?? "").trim();

  if (confirmation !== "SUPPRIMER") {
    redirect(
      `/dashboard/admin/procurement-reset?${buildQuery({
        error: "Confirmation incorrecte : saisissez SUPPRIMER en majuscules.",
      })}`
    );
  }

  const { tenantId } = await requireAdminTenant();

  try {
    const before = await loadProcurementCounts(tenantId);

    const resetResult = await resetTenantProcurementData(tenantId);
    let cleanupResult: ProcurementStorageCleanupDrainResult;
    try {
      cleanupResult = await drainProcurementStorageCleanupOutbox({
        tenantId,
        limit: Math.max(25, Math.min(resetResult.storage_cleanup_queued, 100)),
      });
    } catch (cleanupError) {
      cleanupResult = {
        claimed: 0,
        removed: 0,
        failed: resetResult.storage_cleanup_queued,
        skipped: false,
        errors: [
          cleanupError instanceof Error
            ? cleanupError.message
            : "Le drain Storage n'a pas pu démarrer.",
        ],
      };
    }

    revalidatePath("/dashboard/orders");
    revalidatePath("/dashboard/suppliers");
    revalidatePath("/dashboard/admin/procurement-reset");

    redirect(
      `/dashboard/admin/procurement-reset?${buildQuery({
        done: 1,
        orders: resetResult.orders_deleted,
        suppliers: resetResult.suppliers_deleted,
        prices: resetResult.supplier_prices_deleted,
        itemCount: before.orderItems,
        documentCount: before.orderDocuments,
        storageRemoved: cleanupResult.removed,
        storagePending: Math.max(
          resetResult.storage_cleanup_queued - cleanupResult.removed,
          0
        ),
        storageFailed: cleanupResult.failed,
        storageSkipped: cleanupResult.skipped ? 1 : 0,
      })}`
    );
  } catch (error) {
    redirect(
      `/dashboard/admin/procurement-reset?${buildQuery({
        error:
          error instanceof Error
            ? error.message
            : "Suppression impossible.",
      })}`
    );
  }
}

function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProcurementResetPage({
  searchParams,
}: ProcurementResetPageProps) {
  const params = await searchParams;
  const { tenantId } = await requireAdminTenant();
  const counts = await loadProcurementCounts(tenantId);
  const preview = await loadPreviewRows(tenantId);
  const done = firstParam(params, "done") === "1";
  const error = firstParam(params, "error");
  const storagePending = Number(firstParam(params, "storagePending") ?? "0");
  const storageFailed = Number(firstParam(params, "storageFailed") ?? "0");
  const storageSkipped = firstParam(params, "storageSkipped") === "1";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Nettoyage des achats" },
        ]}
        title="Nettoyage des achats"
        description="Supprime les bons de commande, leurs lignes, les documents attachés, les prix fournisseurs et les fournisseurs de l'organisation courante."
      />

      <div className="flex flex-col gap-6 sm:gap-8">
        {done ? (
          <Alert variant="success">
            Suppression terminée : {firstParam(params, "orders") ?? "0"} bon(s) de commande,{" "}
            {firstParam(params, "suppliers") ?? "0"} fournisseur(s) et{" "}
            {firstParam(params, "prices") ?? "0"} prix fournisseur(s) supprimés.
          </Alert>
        ) : null}

        {done && (storagePending > 0 || storageFailed > 0 || storageSkipped) ? (
          <Alert variant="warning">
            Le nettoyage de la base est terminé. {storagePending} objet(s) Storage
            restent dans la file durable et seront repris automatiquement.
          </Alert>
        ) : null}

        {error ? <Alert variant="danger">{error}</Alert> : null}

        <section aria-labelledby="procurement-reset-counts" className="space-y-3">
          <h2 id="procurement-reset-counts" className="font-semibold text-foreground">
            Données qui seront supprimées
          </h2>
          <StatGrid className="sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Bons de commande" value={counts.orders} />
            <StatCard label="Lignes" value={counts.orderItems} />
            <StatCard label="Documents" value={counts.orderDocuments} />
            <StatCard label="Fournisseurs" value={counts.suppliers} />
            <StatCard label="Prix fournisseurs" value={counts.supplierPrices} />
          </StatGrid>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <PageSection title="Derniers bons de commande">
            {preview.orders.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {preview.orders.map((order) => {
                  const status = ORDER_STATUS_BADGES[order.status] ?? {
                    label: order.status,
                    variant: "neutral" as const,
                  };
                  return (
                    <li
                      key={`${order.reference}-${order.created_at}`}
                      className="flex items-center justify-between gap-4 rounded-lg bg-surface-subtle px-3 py-2"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere] font-medium text-foreground">
                        {order.reference}
                      </span>
                      <Badge variant={status.variant} size="sm">
                        {status.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun bon de commande.</p>
            )}
          </PageSection>

          <PageSection title="Derniers fournisseurs">
            {preview.suppliers.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {preview.suppliers.map((supplier) => (
                  <li
                    key={`${supplier.name}-${supplier.created_at}`}
                    className="[overflow-wrap:anywhere] rounded-lg bg-surface-subtle px-3 py-2 font-medium text-foreground"
                  >
                    {supplier.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun fournisseur.</p>
            )}
          </PageSection>
        </div>

        <section
          aria-labelledby="procurement-reset-danger"
          className="rounded-lg border border-danger-border bg-danger-subtle p-4 sm:p-6"
        >
          <h2 id="procurement-reset-danger" className="font-semibold text-danger">
            Suppression définitive
          </h2>
          <p className="mt-2 text-sm text-foreground-secondary">
            Cette action agit sur la base partagée avec la version en ligne. Elle
            ne supprime pas les chantiers, les affaires, les devis clients, les
            produits ni les utilisateurs.
          </p>
          <form action={resetProcurementData} className="mt-5 flex flex-col gap-2">
            <FieldLabel htmlFor="procurement-reset-confirmation">
              Saisissez SUPPRIMER pour confirmer
            </FieldLabel>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="procurement-reset-confirmation"
                className="border-danger-border sm:max-w-xs"
                name="confirmation"
                placeholder="SUPPRIMER"
                autoComplete="off"
                required
              />
              <button
                className={cn(
                  buttonVariants({ variant: "danger-solid", size: "lg" }),
                  "h-auto min-h-(--density-input-h) whitespace-normal py-2"
                )}
                type="submit"
              >
                <Trash2Icon aria-hidden="true" />
                Supprimer les achats et les fournisseurs
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
