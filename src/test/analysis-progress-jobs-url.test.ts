import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import { readStandaloneJobLanes, STANDALONE_JOB_LANES } from "@/lib/affaires/analysis-progress-jobs";
import { analysisProgressPages } from "@/lib/affaires/analysis-progress-pages";
import type { Database } from "@/types/database";

// The grouped request repeats the member's project list and the lane's cursor in each of the five lanes.
// The hosted gateway answers 520 to a URL over about 16 KB, and the client then sends it again.
// This is the longest request the poll can build: a member at the prefilter limit resuming every lane,
// with the microsecond timestamps the database returns. Fictional identifiers only.
const URL_BUDGET = 14_336;
const HOST = "https://abcdefghijklmnopqrst.supabase.co";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("keeps the longest standalone job request under the gateway's URL limit", async () => {
  const urls: string[] = [];
  const projects = Array.from({ length: 32 }, (_, index) => ({ id: uuid(index + 1) }));
  const supabase = createClient<Database>(HOST, "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        urls.push(url);
        const body = url.includes("/rest/v1/estimate_projects") ? projects : [{ id: uuid(900) }];
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
  const position = { time: "2026-11-27T10:15:30.123456+00:00", id: uuid(901) };
  const cursor = Buffer.from(JSON.stringify(Object.fromEntries(STANDALONE_JOB_LANES.map((lane) => [lane, position]))))
    .toString("base64url");

  await readStandaloneJobLanes({
    supabase, tenantId: uuid(902), owner: uuid(903),
    cutoff: "2026-11-26T10:15:30.123Z", activityCutoff: "2026-11-20T10:15:30.123Z",
    pages: analysisProgressPages(cursor),
  });

  const grouped = urls.filter((url) => url.includes("/rest/v1/tenants"));
  expect(grouped).toHaveLength(1);
  const [url] = grouped;
  // Every lane carries the 32 projects and both halves of its cursor.
  for (const lane of STANDALONE_JOB_LANES) {
    expect(url).toContain(`${lane}.project_id=in.`);
    expect(url).toContain(`${lane}.or=`);
  }
  expect(url.split(uuid(32)).length - 1).toBe(STANDALONE_JOB_LANES.length);
  expect(url.length).toBeLessThan(URL_BUDGET);
});
