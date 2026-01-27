import archiver from "archiver";
import { NextResponse } from "next/server";
import { Readable } from "stream";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type OrderRow = {
  id: string;
  reference: string;
  order_number: number;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  currency: string;
  suppliers: { name: string } | null;
  delivery_sites: { name: string } | null;
};

type OrderItemRow = {
  designation: string;
  reference: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  line_total_ht_cents: number;
};

type DevisRow = {
  id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  position: number;
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function formatEUR(valueCents: number) {
  return (valueCents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeFilename(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
  return normalized.length > 0 ? normalized : "bon_de_commande";
}

function buildOrderHtml(order: OrderRow, items: OrderItemRow[]) {
  const supplierName = order.suppliers?.name ?? "Fournisseur";
  const siteName = order.delivery_sites?.name ?? "Chantier";
  const reference = order.reference || String(order.order_number);
  const orderDate = formatDate(order.order_date);
  const expectedDelivery = formatDate(order.expected_delivery_date);
  const notes = order.notes?.trim() ?? "";

  const rows = items
    .map((item) => {
      const designation = escapeHtml(item.designation || "-");
      const referenceItem = escapeHtml(item.reference ?? "");
      return `
        <tr>
          <td>${designation}</td>
          <td>${referenceItem}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${formatEUR(item.unit_price_ht_cents)}</td>
          <td class="num">${formatEUR(item.line_total_ht_cents)}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bon de commande ${escapeHtml(reference)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: #0f172a;
        background: #ffffff;
      }
      body {
        margin: 0;
        padding: 32px 40px;
      }
      h1 {
        font-size: 22px;
        margin: 0 0 8px;
      }
      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin: 24px 0;
      }
      .card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 16px;
        background: #f8fafc;
      }
      .label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748b;
        margin-bottom: 4px;
      }
      .value {
        font-weight: 600;
        color: #1e293b;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
      }
      th, td {
        padding: 10px 12px;
        border-bottom: 1px solid #e2e8f0;
        font-size: 13px;
      }
      th {
        text-align: left;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748b;
        background: #f1f5f9;
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .totals {
        margin-top: 18px;
        display: flex;
        justify-content: flex-end;
      }
      .totals .card {
        min-width: 240px;
      }
      .notes {
        margin-top: 18px;
        padding: 12px 14px;
        border-left: 4px solid #1e3a5f;
        background: #f8fafc;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <h1>Bon de commande ${escapeHtml(reference)}</h1>
    <div class="meta">
      <div class="card">
        <div class="label">Fournisseur</div>
        <div class="value">${escapeHtml(supplierName)}</div>
      </div>
      <div class="card">
        <div class="label">Chantier</div>
        <div class="value">${escapeHtml(siteName)}</div>
      </div>
      <div class="card">
        <div class="label">Date commande</div>
        <div class="value">${escapeHtml(orderDate)}</div>
      </div>
      <div class="card">
        <div class="label">Livraison prevue</div>
        <div class="value">${escapeHtml(expectedDelivery || "-")}</div>
      </div>
      <div class="card">
        <div class="label">Statut</div>
        <div class="value">${escapeHtml(order.status)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Designation</th>
          <th>Reference</th>
          <th class="num">Qte</th>
          <th class="num">P.U. HT</th>
          <th class="num">Total HT</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="5">Aucun article</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="card">
        <div class="label">Total HT</div>
        <div class="value">${formatEUR(order.total_ht_cents)}</div>
        <div class="label" style="margin-top:10px;">Total TVA</div>
        <div class="value">${formatEUR(order.total_tax_cents)}</div>
        <div class="label" style="margin-top:10px;">Total TTC</div>
        <div class="value">${formatEUR(order.total_ttc_cents)}</div>
      </div>
    </div>

    ${
      notes
        ? `<div class="notes"><div class="label">Notes</div>${escapeHtml(notes)}</div>`
        : ""
    }
  </body>
</html>`;
}

async function blobToReadable(blob: Blob) {
  if ("stream" in blob) {
    const stream = blob.stream();
    if ("fromWeb" in Readable) {
      return Readable.fromWeb(stream as never);
    }
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  return Readable.from(buffer);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderPromise = supabase
    .from("purchase_orders")
    .select(
      "id, reference, order_number, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, currency, suppliers ( name ), delivery_sites ( name )"
    )
    .eq("id", id)
    .single();

  const itemsPromise = supabase
    .from("purchase_order_items")
    .select("designation, reference, quantity, unit_price_ht_cents, line_total_ht_cents")
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  const devisPromise = supabase
    .from("purchase_order_devis")
    .select("id, name, original_filename, storage_path, file_size_bytes, mime_type, position")
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  const [{ data: order, error: orderError }, itemsResult, devisResult] = await Promise.all([
    orderPromise,
    itemsPromise,
    devisPromise,
  ]);

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  const items = (itemsResult.data ?? []) as OrderItemRow[];
  const devis = (devisResult.data ?? []) as DevisRow[];
  const orderHtml = buildOrderHtml(order as unknown as OrderRow, items);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.append(orderHtml, { name: "bon-de-commande.html" });

  const usedNames = new Set<string>();
  for (const [index, item] of devis.entries()) {
    try {
      const { data } = await supabase.storage.from("devis").download(item.storage_path);
      if (!data) {
        continue;
      }

      const baseName =
        sanitizeFilename(item.original_filename || item.name || `document-${index + 1}`);
      let fileName = baseName;
      let counter = 1;
      while (usedNames.has(fileName)) {
        fileName = `${baseName}-${counter++}`;
      }
      usedNames.add(fileName);

      const readable = await blobToReadable(data);
      archive.append(readable, { name: `documents/${fileName}` });
    } catch {
      continue;
    }
  }

  const zipFilename = sanitizeFilename(
    `bon_de_commande_${order.reference || order.order_number}`
  );

  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${zipFilename}.zip"`,
  });

  const zipStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  archive.finalize();

  return new Response(zipStream, { headers });
}
