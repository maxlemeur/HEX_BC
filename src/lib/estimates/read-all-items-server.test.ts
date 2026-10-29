import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "./read-all-items-server";

function fixture(options: { size?: number; failAt?: number; changedAt?: number; duplicateAt?: number; cap?: number } = {}) {
  const rows = Array.from({ length: options.size ?? 2501 }, (_, index) => ({
    id: String(index).padStart(5, "0"), tenant_id: "tenant", version_id: "version",
    position: Math.floor(index / 2), item_type: "line", parent_id: "section",
  }));
  const requests: URL[] = [];
  const completed: number[] = [];
  const pending: { offset: number; resolve: () => void }[] = [];
  let flush: ReturnType<typeof setTimeout> | undefined;
  let active = 0; let peak = 0;
  const supabase = createClient<Database>("https://example.test", "test-anon", { global: { fetch: async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.endsWith("/estimate_versions")) return new Response(JSON.stringify({
      id: "version", tenant_id: "tenant", project_id: "project", status: "draft",
      updated_at: "2026-10-20T00:00:00Z", content_revision: 2,
    }), { headers: { "content-type": "application/json" } });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    active++; peak = Math.max(peak, active);
    if (offset > 0) await new Promise<void>(resolve => {
      pending.push({ offset, resolve });
      flush ??= setTimeout(() => {
        flush = undefined;
        for (const page of pending.splice(0).sort((a, b) => b.offset - a.offset)) page.resolve();
      }, 0);
    });
    active--; completed.push(offset);
    if (offset === options.failAt) return new Response(JSON.stringify({ code: "XX001", message: "page failed" }), { status: 500 });
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), options.cap ?? 1000);
    const page = rows.slice(offset, offset + limit);
    if (offset === options.duplicateAt && page.length) page[0] = rows[0];
    const count = rows.length + (offset === options.changedAt ? 1 : 0);
    return new Response(JSON.stringify(page), { headers: {
      "content-type": "application/json", "content-range": `${offset}-${offset + page.length - 1}/${count}`,
    } });
  } } });
  return { input: { supabase, tenantId: "tenant", versionId: "version" }, rows, requests, completed, peak: () => peak };
}

describe("complete estimate item transport", () => {
  it("assembles reversed pages in position/id order with at most four requests", async () => {
    const f = fixture();
    expect(await readAllEstimateItems(f.input)).toEqual(f.rows);
    expect(f.peak()).toBe(4);
    expect(f.completed.slice(1, 5)).toEqual([2000, 1500, 1000, 500]);
    expect(f.requests.every(url => url.pathname === "/rest/v1/rpc/read_estimate_version_items"
      && url.searchParams.get("p_tenant_id") === "tenant"
      && url.searchParams.get("p_version_id") === "version"
      && url.searchParams.get("order") === "position.asc,id.asc"
      && Number(url.searchParams.get("limit")) <= 500)).toBe(true);
  });
  it.each([{ cap: 200 }, { changedAt: 1000 }, { duplicateAt: 1500 }, { failAt: 1000 }])("rejects a partial or changing version: %j", async options => {
    const f = fixture(options);
    await expect(readAllEstimateItems(f.input)).rejects.toThrow();
  });
  it("still rejects a content revision changed during the paginated read", async () => {
    const f = fixture();
    await readAllEstimateItems(f.input);
    await expect(assertEstimateVersionUnchanged({ supabase: f.input.supabase, version: {
      id: "version", tenant_id: "tenant", project_id: "project", status: "draft",
      updated_at: "2026-10-20T00:00:00Z", content_revision: 1,
    } })).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });
});
