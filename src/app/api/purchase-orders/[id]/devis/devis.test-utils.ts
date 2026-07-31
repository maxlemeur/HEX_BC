import { vi } from "vitest";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const ORDER_ID = "22222222-2222-4222-8222-222222222222";
export const TENANT_ID = "33333333-3333-4333-8333-333333333333";
export const DEVIS_ID = "44444444-4444-4444-8444-444444444444";
export const SECOND_DEVIS_ID = "55555555-5555-4555-8555-555555555555";

export type DevisRecord = {
  id: string;
  created_at: string;
  name: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  position: number;
};

type ErrorLike = { message: string };
type QueryResult<T> = { data: T; error: ErrorLike | null };

type QueryHarness<T> = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: PromiseLike<QueryResult<T>>["then"];
};

function createQueryHarness<T>(result: QueryResult<T>): QueryHarness<T> {
  const query = {} as QueryHarness<T>;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue(result);
  query.then = <TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
  return query;
}

export function buildDevisRecord(
  overrides: Partial<DevisRecord> = {}
): DevisRecord {
  return {
    id: DEVIS_ID,
    created_at: "2026-07-31T08:00:00.000Z",
    name: "Offre fournisseur",
    original_filename: "offre.pdf",
    storage_path: `purchase-orders/${ORDER_ID}/offre.pdf`,
    file_size_bytes: 7,
    mime_type: "application/pdf",
    position: 1,
    ...overrides,
  };
}

type SupabaseMockOptions = {
  user?: { id: string } | null;
  listData?: DevisRecord[] | null;
  listError?: ErrorLike | null;
  lastPosition?: number | null;
  insertedData?: DevisRecord | null;
  insertError?: ErrorLike | null;
  updatedData?: DevisRecord | null;
  updateError?: ErrorLike | null;
  lookupData?: { id: string; storage_path: string } | null;
  lookupError?: ErrorLike | null;
  deleteError?: ErrorLike | null;
  reorderData?: { id: string }[] | null;
  reorderFetchError?: ErrorLike | null;
  rpcUpdatedCount?: number | null;
  rpcError?: ErrorLike | null;
  uploadError?: ErrorLike | null;
  removeError?: ErrorLike | null;
  signedUrlErrorPath?: string;
  signedUrlError?: ErrorLike;
};

export function createDevisSupabaseMock(options: SupabaseMockOptions = {}) {
  const listData = options.listData === undefined ? [] : options.listData;
  const positionData =
    options.lastPosition === undefined || options.lastPosition === null
      ? []
      : [{ position: options.lastPosition }];
  const insertedData =
    options.insertedData === undefined
      ? buildDevisRecord()
      : options.insertedData;
  const updatedData =
    options.updatedData === undefined ? buildDevisRecord() : options.updatedData;
  const lookupData =
    options.lookupData === undefined
      ? { id: DEVIS_ID, storage_path: buildDevisRecord().storage_path }
      : options.lookupData;
  const reorderData =
    options.reorderData === undefined
      ? [{ id: DEVIS_ID }, { id: SECOND_DEVIS_ID }]
      : options.reorderData;

  const queries = {
    list: createQueryHarness({
      data: listData,
      error: options.listError ?? null,
    }),
    position: createQueryHarness({ data: positionData, error: null }),
    insert: createQueryHarness({
      data: insertedData,
      error: options.insertError ?? null,
    }),
    update: createQueryHarness({
      data: updatedData,
      error: options.updateError ?? null,
    }),
    lookup: createQueryHarness({
      data: lookupData,
      error: options.lookupError ?? null,
    }),
    delete: createQueryHarness({ data: null, error: options.deleteError ?? null }),
    reorder: createQueryHarness({
      data: reorderData,
      error: options.reorderFetchError ?? null,
    }),
  };

  const select = vi.fn((columns: string) => {
    if (columns === "position") return queries.position;
    if (columns === "id, storage_path") return queries.lookup;
    if (columns === "id") return queries.reorder;
    return queries.list;
  });
  const insert = vi.fn(() => queries.insert);
  const update = vi.fn(() => queries.update);
  const deleteRows = vi.fn(() => queries.delete);
  const from = vi.fn((table: string) => {
    if (table !== "purchase_order_devis") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return { select, insert, update, delete: deleteRows };
  });

  const upload = vi.fn().mockResolvedValue({
    data: null,
    error: options.uploadError ?? null,
  });
  const remove = vi.fn().mockResolvedValue({
    data: null,
    error: options.removeError ?? null,
  });
  const createSignedUrl = vi.fn(async (storagePath: string) => {
    if (storagePath === options.signedUrlErrorPath) {
      return {
        data: null,
        error: options.signedUrlError ?? { message: "signature indisponible" },
      };
    }
    return {
      data: {
        signedUrl: `https://storage.test/${encodeURIComponent(storagePath)}`,
      },
      error: null,
    };
  });
  const storageFrom = vi.fn((bucket: string) => {
    if (bucket !== "devis") {
      throw new Error(`Unexpected bucket: ${bucket}`);
    }
    return { upload, remove, createSignedUrl };
  });

  const defaultUpdatedCount = reorderData?.length ?? 0;
  const rpc = vi.fn().mockResolvedValue({
    data:
      options.rpcUpdatedCount === undefined
        ? defaultUpdatedCount
        : options.rpcUpdatedCount,
    error: options.rpcError ?? null,
  });
  const user = options.user === undefined ? { id: USER_ID } : options.user;

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from,
    rpc,
    storage: { from: storageFrom },
  };

  return {
    supabase,
    queries,
    from,
    select,
    insert,
    update,
    deleteRows,
    rpc,
    storageFrom,
    upload,
    remove,
    createSignedUrl,
  };
}
