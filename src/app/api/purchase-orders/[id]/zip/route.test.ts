import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/purchase-orders", () => ({
  getAccessiblePurchaseOrderOrNull: vi.fn(),
}));

import { GET } from "@/app/api/purchase-orders/[id]/zip/route";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { unauthorized } from "@/lib/estimates/errors";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";

const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";

/**
 * Lecteur ZIP minimal (sans dependance) : lit le repertoire central puis
 * decompresse chaque entree depuis son en-tete local. Archiver ecrit en
 * streaming, donc les tailles de l'en-tete local sont nulles (bit 3) : seul le
 * repertoire central fait foi.
 */
function readZipEntries(buffer: Buffer) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Archive invalide : fin de repertoire central introuvable.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries: { name: string; content: Buffer }[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Archive invalide : entree de repertoire central cassee.");
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Archive invalide : en-tete local absent pour ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      content: compressionMethod === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    reference: "BC-2026-001",
    order_number: 42,
    status: "sent",
    order_date: "2026-07-01",
    expected_delivery_date: "2026-07-15",
    notes: "Livraison en matinee",
    total_ht_cents: 100_000,
    total_tax_cents: 20_000,
    total_ttc_cents: 120_000,
    currency: "EUR",
    suppliers: { name: "Fournisseur Test" },
    delivery_sites: { name: "Chantier Nord" },
    ...overrides,
  };
}

type DevisFixture = {
  id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  position: number;
};

function createSupabaseMock(options: {
  items?: Record<string, unknown>[];
  devis?: DevisFixture[];
  downloads?: Record<string, Blob | null | (() => never)>;
} = {}) {
  const {
    items = [],
    devis = [],
    downloads = {},
  } = options;

  const download = vi.fn(async (storagePath: string) => {
    const entry = downloads[storagePath];
    if (typeof entry === "function") {
      entry();
    }
    return { data: entry ?? null, error: null };
  });

  const selectFor = (rows: Record<string, unknown>[]) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      })),
    })),
  });

  return {
    download,
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "purchase_order_items") return selectFor(items);
        if (table === "purchase_order_devis") return selectFor(devis);
        throw new Error(`Unexpected table: ${table}`);
      }),
      storage: {
        from: vi.fn((bucket: string) => {
          if (bucket !== "devis") {
            throw new Error(`Unexpected bucket: ${bucket}`);
          }
          return { download };
        }),
      },
    },
  };
}

function mockTenantContext(supabase: unknown) {
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
    supabase,
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: "engineer",
    isTenantAdmin: false,
    membership: {
      id: "membership-1",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: "engineer",
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  } as AuthenticatedTenantContext);
}

function callRoute() {
  return GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: ORDER_ID }),
  });
}

async function readZipResponse(response: Response) {
  return readZipEntries(Buffer.from(await response.arrayBuffer()));
}

const mockedGetOrder = vi.mocked(getAccessiblePurchaseOrderOrNull);

describe("purchase order zip route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockRejectedValue(unauthorized());

    const response = await callRoute();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockedGetOrder).not.toHaveBeenCalled();
  });

  it("returns 404 when the order is not accessible", async () => {
    const { supabase } = createSupabaseMock();
    mockTenantContext(supabase);
    mockedGetOrder.mockResolvedValue(null);

    const response = await callRoute();

    expect(response.status).toBe(404);
  });

  // Regression : archiver 8 est passe en ESM pur sans export par defaut
  // appelable. L'ancien `archiver("zip", ...)` compilait encore chez certains
  // resolveurs mais explosait a l'execution. On verifie donc que la reponse est
  // une archive ZIP reellement lisible, pas seulement un 200.
  it("streams a readable zip containing the order html", async () => {
    const { supabase } = createSupabaseMock({
      items: [
        {
          designation: "Poutre IPE 200",
          reference: "IPE200",
          quantity: 4,
          unit_price_ht_cents: 25_000,
          line_total_ht_cents: 100_000,
        },
      ],
    });
    mockTenantContext(supabase);
    mockedGetOrder.mockResolvedValue(buildOrder());

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bon_de_commande_BC-2026-001.zip"'
    );

    const entries = await readZipResponse(response);
    expect(entries.map((entry) => entry.name)).toEqual([
      "bon-de-commande.html",
    ]);

    const html = entries[0].content.toString("utf8");
    expect(html).toContain("BC-2026-001");
    expect(html).toContain("Fournisseur Test");
    expect(html).toContain("Chantier Nord");
    expect(html).toContain("Poutre IPE 200");
  });

  it("appends downloaded devis under documents/ and de-duplicates names", async () => {
    const devis: DevisFixture[] = [
      {
        id: "devis-1",
        name: "Devis A",
        original_filename: "devis.pdf",
        storage_path: "tenant/devis-1.pdf",
        file_size_bytes: 12,
        mime_type: "application/pdf",
        position: 1,
      },
      {
        id: "devis-2",
        name: "Devis B",
        original_filename: "devis.pdf",
        storage_path: "tenant/devis-2.pdf",
        file_size_bytes: 12,
        mime_type: "application/pdf",
        position: 2,
      },
    ];

    const { supabase, download } = createSupabaseMock({
      devis,
      downloads: {
        "tenant/devis-1.pdf": new Blob(["contenu-devis-1"]),
        "tenant/devis-2.pdf": new Blob(["contenu-devis-2"]),
      },
    });
    mockTenantContext(supabase);
    mockedGetOrder.mockResolvedValue(buildOrder());

    const response = await callRoute();
    const entries = await readZipResponse(response);

    expect(download).toHaveBeenCalledTimes(2);
    expect(entries.map((entry) => entry.name)).toEqual([
      "bon-de-commande.html",
      "documents/devis.pdf",
      "documents/devis.pdf-1",
    ]);

    const byName = new Map(entries.map((entry) => [entry.name, entry.content]));
    expect(byName.get("documents/devis.pdf")?.toString("utf8")).toBe(
      "contenu-devis-1"
    );
    expect(byName.get("documents/devis.pdf-1")?.toString("utf8")).toBe(
      "contenu-devis-2"
    );
  });

  it("skips devis that fail to download without breaking the archive", async () => {
    const devis: DevisFixture[] = [
      {
        id: "devis-ko",
        name: "Devis KO",
        original_filename: "casse.pdf",
        storage_path: "tenant/casse.pdf",
        file_size_bytes: 0,
        mime_type: "application/pdf",
        position: 1,
      },
      {
        id: "devis-ok",
        name: "Devis OK",
        original_filename: "ok.pdf",
        storage_path: "tenant/ok.pdf",
        file_size_bytes: 9,
        mime_type: "application/pdf",
        position: 2,
      },
    ];

    const { supabase } = createSupabaseMock({
      devis,
      downloads: {
        "tenant/casse.pdf": () => {
          throw new Error("storage down");
        },
        "tenant/ok.pdf": new Blob(["contenu-ok"]),
      },
    });
    mockTenantContext(supabase);
    mockedGetOrder.mockResolvedValue(buildOrder());

    const response = await callRoute();
    const entries = await readZipResponse(response);

    expect(response.status).toBe(200);
    expect(entries.map((entry) => entry.name)).toEqual([
      "bon-de-commande.html",
      "documents/ok.pdf",
    ]);
  });

  it("falls back to the order number when the reference is empty", async () => {
    const { supabase } = createSupabaseMock();
    mockTenantContext(supabase);
    mockedGetOrder.mockResolvedValue(buildOrder({ reference: "" }));

    const response = await callRoute();

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bon_de_commande_42.zip"'
    );
    await expect(readZipResponse(response)).resolves.toHaveLength(1);
  });
});
