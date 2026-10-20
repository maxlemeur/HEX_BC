import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readAllRows, readAllRowsInChunks } from "./read-all";

function fixture(options: { failAt?: number; cap?: number; changedCountAt?: number; duplicateAt?: number; reverse?: boolean } = {}) {
  const rows = Array.from({ length: 2501 }, (_, id) => ({ id: String(id).padStart(5, "0"), value: id }));
  const requests: URL[] = [];
  const completed: number[] = [];
  let active = 0;
  let peak = 0;
  let flush: ReturnType<typeof setTimeout> | undefined;
  const waiting: { offset: number; resolve: () => void }[] = [];
  const client = createClient("https://example.test", "test-anon", { global: { fetch: async input => {
    const url = new URL(String(input)); requests.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    active++; peak = Math.max(peak, active);
    if (options.reverse && offset > 0) await new Promise<void>(resolve => {
      waiting.push({ offset, resolve });
      flush ??= setTimeout(() => {
        flush = undefined;
        for (const page of waiting.splice(0).sort((a, b) => b.offset - a.offset)) page.resolve();
      }, 0);
    });
    active--; completed.push(offset);
    if (offset === options.failAt) return new Response(JSON.stringify({ code: "XX001", message: "page failed", details: "", hint: "" }), { status: 500 });
    const filter = url.searchParams.get("id");
    const selected = filter ? rows.filter(row => filter.slice(4, -1).split(",").includes(row.id)) : rows;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), options.cap ?? 1000);
    const page = selected.slice(offset, offset + limit);
    if (offset === options.duplicateAt && page.length) page[0] = selected[0];
    const count = selected.length + (offset === options.changedCountAt ? 1 : 0);
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json", "content-range": `${offset}-${offset + page.length - 1}/${count}` } });
  } } });
  return { rows, requests, completed, peak: () => peak, query: () => client.from("items").select("id,value", { count: "exact" }).eq("tenant_id", "tenant") };
}

describe("complete PostgREST reads", () => {
  it("returns every row past the server cap, preserving the tenant filter", async () => {
    const f = fixture(); const result = await readAllRows(f.query);
    expect(result.error).toBeNull(); expect(result.data).toEqual(f.rows); expect(result.count).toBe(2501);
    expect(f.requests.map(url => Number(url.searchParams.get("offset")))).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(f.requests.every(url => url.searchParams.get("tenant_id") === "eq.tenant" && Number(url.searchParams.get("limit")) <= 500)).toBe(true);
  });
  it("honors the caller's business limit across pages", async () => {
    const f = fixture(); const result = await readAllRows(f.query, { limit: 1101 });
    expect(result.data).toEqual(f.rows.slice(0, 1101)); expect(f.requests).toHaveLength(3);
  });
  it.each([{ cap: 200 }, { changedCountAt: 500 }, { duplicateAt: 500 }])("rejects incomplete or inconsistent transport: %j", async options => {
    const f = fixture(options); await expect(readAllRows(f.query)).rejects.toThrow(/compl|chang|coh/i);
  });
  it("never exposes a successful prefix if a later page fails", async () => {
    const f = fixture({ failAt: 1000 }); const result = await readAllRows(f.query);
    expect(result.data).toBeNull(); expect(result.error?.message).toBe("page failed");
  });
  it("bounds fresh-query concurrency and restores offset order after reversed HTTP responses", async () => {
    const f = fixture({ reverse: true });
    const result = await readAllRows(f.query, { concurrency: 4 });
    expect(result.data).toEqual(f.rows);
    expect(f.peak()).toBe(4);
    expect(f.completed.slice(1, 5)).toEqual([2000, 1500, 1000, 500]);
    expect(f.requests.every(url => url.searchParams.get("order") === "id.asc"
      && url.searchParams.get("tenant_id") === "eq.tenant")).toBe(true);
  });
  it("keeps shared mutable builders compatible on the default path", async () => {
    const f = fixture({ reverse: true }); const shared = f.query();
    const result = await readAllRows(() => shared);
    expect(result.data).toEqual(f.rows); expect(f.peak()).toBe(1);
    expect(f.requests.every(url => url.searchParams.get("order") === "id.asc")).toBe(true);
  });
  it("bounds concurrent pages by the business limit", async () => {
    const f = fixture({ reverse: true });
    const result = await readAllRows(f.query, { concurrency: 4, limit: 1101 });
    expect(result.data).toEqual(f.rows.slice(0, 1101));
    expect(f.requests.map(url => [url.searchParams.get("offset"), url.searchParams.get("limit")]))
      .toEqual([["0", "500"], ["500", "500"], ["1000", "101"]]);
  });
  it.each([{ cap: 200 }, { changedCountAt: 1000 }, { duplicateAt: 1500 }])("rejects a corrupt concurrent page: %j", async options => {
    const f = fixture({ ...options, reverse: true });
    await expect(readAllRows(f.query, { concurrency: 4 })).rejects.toThrow(/compl|chang|coh/i);
  });
  it("never returns the good concurrent pages around a failed page", async () => {
    const f = fixture({ failAt: 1000, reverse: true });
    const result = await readAllRows(f.query, { concurrency: 4 });
    expect(result.data).toBeNull(); expect(result.error?.message).toBe("page failed");
  });
  it("bounds IN URLs, reads all chunks, and preserves unique identities", async () => {
    const f = fixture(); const ids = f.rows.map(row => row.id);
    const result = await readAllRowsInChunks(ids, chunk => f.query().in("id", chunk));
    expect(result.data?.map(row => row.id).sort()).toEqual(ids); expect(result.count).toBe(2501);
    expect(f.requests.every(url => url.searchParams.get("id")!.slice(4, -1).split(",").length <= 150)).toBe(true);
  });
  it("bounds encoded URLs when the IN values are long designations", async () => {
    const requests: URL[] = [];
    const client = createClient("https://example.test", "test-anon", { global: { fetch: async input => {
      requests.push(new URL(String(input)));
      return new Response("[]", { headers: { "content-type": "application/json", "content-range": "*/0" } });
    } } });
    const values = Array.from({ length: 170 }, (_, i) => `${i} ${"Équipement / ".repeat(30)}`);
    await readAllRowsInChunks(values, chunk => client.from("items").select("id", { count: "exact" }).in("title", chunk));
    expect(requests.every(url => url.href.length < 8000)).toBe(true);
    expect(requests.length).toBeGreaterThan(2);
  });
});
