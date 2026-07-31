import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/purchase-orders", () => ({
  canWritePurchaseOrders: vi.fn(),
  getAccessiblePurchaseOrderOrNull: vi.fn(),
}));

import { GET, POST } from "@/app/api/purchase-orders/[id]/devis/route";
import {
  DEVIS_ID,
  ORDER_ID,
  SECOND_DEVIS_ID,
  TENANT_ID,
  USER_ID,
  buildDevisRecord,
  createDevisSupabaseMock,
} from "@/app/api/purchase-orders/[id]/devis/devis.test-utils";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const params = { params: Promise.resolve({ id: ORDER_ID }) };
const mockedCreateClient = vi.mocked(createSupabaseServerClient);
const mockedGetOrder = vi.mocked(getAccessiblePurchaseOrderOrNull);
const mockedCanWrite = vi.mocked(canWritePurchaseOrders);

function installHarness(
  options: Parameters<typeof createDevisSupabaseMock>[0] = {}
) {
  const harness = createDevisSupabaseMock(options);
  mockedCreateClient.mockResolvedValue(harness.supabase as never);
  return harness;
}

function uploadRequest(file: File, name?: string) {
  const formData = new FormData();
  formData.set("file", file);
  if (name !== undefined) formData.set("name", name);
  return new Request(`http://localhost/api/purchase-orders/${ORDER_ID}/devis`, {
    method: "POST",
    body: formData,
  });
}

describe("purchase order devis collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOrder.mockResolvedValue({
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      status: "draft",
    } as never);
    mockedCanWrite.mockResolvedValue(true);
  });

  it("lists devis in position order with their signed URLs", async () => {
    const records = [
      buildDevisRecord(),
      buildDevisRecord({
        id: SECOND_DEVIS_ID,
        name: "Offre B",
        original_filename: "offre-b.xlsx",
        storage_path: `purchase-orders/${ORDER_ID}/offre-b.xlsx`,
        file_size_bytes: 12,
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        position: 2,
      }),
    ];
    const harness = installHarness({ listData: records });

    const response = await GET(new Request("http://localhost"), params);

    expect(response.status).toBe(200);
    expect(harness.queries.list.eq).toHaveBeenCalledWith(
      "purchase_order_id",
      ORDER_ID
    );
    expect(harness.queries.list.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(harness.createSignedUrl).toHaveBeenCalledTimes(2);
    expect(harness.createSignedUrl).toHaveBeenNthCalledWith(
      1,
      records[0].storage_path,
      600
    );
    expect(await response.json()).toEqual({
      items: records.map((record) => ({
        id: record.id,
        name: record.name,
        originalFilename: record.original_filename,
        fileSizeBytes: record.file_size_bytes,
        mimeType: record.mime_type,
        createdAt: record.created_at,
        position: record.position,
        downloadUrl: `https://storage.test/${encodeURIComponent(record.storage_path)}`,
      })),
    });
  });

  it("fails the list atomically when one signed URL cannot be created", async () => {
    const brokenPath = `purchase-orders/${ORDER_ID}/broken.pdf`;
    const harness = installHarness({
      listData: [
        buildDevisRecord(),
        buildDevisRecord({ id: SECOND_DEVIS_ID, storage_path: brokenPath }),
      ],
      signedUrlErrorPath: brokenPath,
      signedUrlError: { message: "storage indisponible" },
    });

    const response = await GET(new Request("http://localhost"), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "storage indisponible" });
    expect(harness.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty upload before resolving order access", async () => {
    installHarness();

    const response = await POST(
      uploadRequest(new File([], "offre.pdf", { type: "application/pdf" })),
      params
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Le fichier est vide." });
    expect(mockedGetOrder).not.toHaveBeenCalled();
  });

  it("normalizes upload metadata and appends the next position", async () => {
    const inserted = buildDevisRecord({
      name: "Offre finale",
      original_filename: "../offre été.eml",
      storage_path: `purchase-orders/${ORDER_ID}/inserted.eml`,
      mime_type: "message/rfc822",
      position: 5,
    });
    const harness = installHarness({ lastPosition: 4, insertedData: inserted });
    const file = new File(["payload"], "../offre été.eml", {
      type: "message/rfc822",
    });

    const response = await POST(uploadRequest(file, "  Offre finale  "), params);

    expect(response.status).toBe(201);
    expect(harness.queries.position.eq).toHaveBeenCalledWith(
      "purchase_order_id",
      ORDER_ID
    );
    expect(harness.queries.position.order).toHaveBeenCalledWith("position", {
      ascending: false,
    });
    expect(harness.queries.position.limit).toHaveBeenCalledWith(1);

    const [storagePath, uploadedFile, uploadOptions] = harness.upload.mock.calls[0];
    expect(storagePath).toMatch(
      new RegExp(`^purchase-orders/${ORDER_ID}/[0-9a-f-]+-offre-t-\\.eml$`)
    );
    expect(uploadedFile).toBeInstanceOf(File);
    expect(uploadOptions).toEqual({
      contentType: "application/octet-stream",
      upsert: false,
    });
    expect(harness.insert).toHaveBeenCalledWith({
      purchase_order_id: ORDER_ID,
      user_id: USER_ID,
      name: "Offre finale",
      original_filename: "../offre été.eml",
      storage_path: storagePath,
      file_size_bytes: 7,
      mime_type: "message/rfc822",
      position: 5,
    });
    expect(await response.json()).toMatchObject({
      item: {
        id: DEVIS_ID,
        name: "Offre finale",
        position: 5,
      },
    });
  });

  it("removes the uploaded object when the database insert fails", async () => {
    const harness = installHarness({
      insertedData: null,
      insertError: { message: "insert refused" },
    });
    const file = new File(["payload"], "offre.pdf", {
      type: "application/pdf",
    });

    const response = await POST(uploadRequest(file), params);

    const storagePath = harness.upload.mock.calls[0]?.[0];
    expect(response.status).toBe(400);
    expect(harness.remove).toHaveBeenCalledOnce();
    expect(harness.remove).toHaveBeenCalledWith([storagePath]);
    expect(harness.createSignedUrl).not.toHaveBeenCalled();
  });
});
