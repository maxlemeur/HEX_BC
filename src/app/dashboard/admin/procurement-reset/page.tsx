import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/auth/server";
import {
  drainProcurementStorageCleanupOutbox,
  type ProcurementStorageCleanupDrainResult,
} from "@/lib/procurement/storage-cleanup-outbox";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    throw new Error("La base n'a pas renvoye le bilan du nettoyage achats.");
  }

  const record = value as Record<string, unknown>;
  const readCount = (key: keyof ProcurementResetResult) => {
    const count = record[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error("Le bilan du nettoyage achats est invalide.");
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
        error: "Confirmation incorrecte.",
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
            : "Le drain Storage n'a pas pu demarrer.",
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
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Administration
        </p>
        <h1 className="mt-2 text-2xl font-bold text-foreground">
          Nettoyage achats
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Supprime les bons de commande, les lignes, les documents attaches, les
          prix fournisseurs et les fournisseurs du tenant courant.
        </p>
      </div>

      {done ? (
        <div className="alert alert-success">
          Suppression terminee : {firstParam(params, "orders") ?? "0"} bon(s),
          {" "}
          {firstParam(params, "suppliers") ?? "0"} fournisseur(s) et{" "}
          {firstParam(params, "prices") ?? "0"} prix fournisseur(s) supprimes.
        </div>
      ) : null}

      {done && (storagePending > 0 || storageFailed > 0 || storageSkipped) ? (
        <div className="alert alert-warning">
          Le nettoyage base est termine. {storagePending} objet(s) Storage
          restent dans la file durable et seront repris automatiquement.
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="dashboard-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          Donnees qui seront supprimees
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-bold text-foreground">{counts.orders}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Bons
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-bold text-foreground">
              {counts.orderItems}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Lignes
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-bold text-foreground">
              {counts.orderDocuments}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Documents
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-bold text-foreground">
              {counts.suppliers}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Fournisseurs
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-2xl font-bold text-foreground">
              {counts.supplierPrices}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Prix
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="dashboard-card p-6">
          <h2 className="text-sm font-semibold text-foreground">
            Derniers bons
          </h2>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {preview.orders.length > 0 ? (
              preview.orders.map((order) => (
                <div
                  key={`${order.reference}-${order.created_at}`}
                  className="flex items-center justify-between gap-4 rounded-lg bg-surface-subtle px-3 py-2"
                >
                  <span className="font-medium text-foreground">
                    {order.reference}
                  </span>
                  <span>{order.status}</span>
                </div>
              ))
            ) : (
              <p>Aucun bon de commande.</p>
            )}
          </div>
        </div>

        <div className="dashboard-card p-6">
          <h2 className="text-sm font-semibold text-foreground">
            Derniers fournisseurs
          </h2>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            {preview.suppliers.length > 0 ? (
              preview.suppliers.map((supplier) => (
                <div
                  key={`${supplier.name}-${supplier.created_at}`}
                  className="rounded-lg bg-surface-subtle px-3 py-2 font-medium text-foreground"
                >
                  {supplier.name}
                </div>
              ))
            ) : (
              <p>Aucun fournisseur.</p>
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-card border-red-200 bg-red-50 p-6">
        <h2 className="text-sm font-semibold text-red-900">
          Suppression definitive
        </h2>
        <p className="mt-2 text-sm text-red-800">
          Cette action agit sur la base partagee avec la version en ligne. Elle
          ne supprime pas les chantiers, les affaires, les devis clients, les
          produits ni les utilisateurs.
        </p>
        <form action={resetProcurementData} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            className="input max-w-xs border-red-300 bg-white"
            name="confirmation"
            placeholder="Tapez SUPPRIMER"
            required
          />
          <button className="btn bg-red-700 text-white hover:bg-red-800" type="submit">
            Supprimer achats et fournisseurs
          </button>
        </form>
      </section>
    </div>
  );
}
