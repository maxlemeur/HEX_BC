import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseTakeoffItemPlanReading, type TakeoffItemPlanReading } from "@/lib/takeoff/item-answers";
import { PLUMBING_TEMPLATE } from "@/lib/takeoff/plumbing-template";

import { querySql } from "../local/calculation-gate-support";
import { assertOwnedCampaign } from "./plan-dispatch-support";
import type { WorkerOwner } from "./worker-support";

// The second measuring order (lot 4) on the owned worker stack: its activation for the duration of a journey, the list of
// an affaire without a DPGF taken from its tenant's published template (a dedicated owner's own tenant), and the stored
// answers read back as a member reads them (public.read_takeoff_item_readings, migration
// 20261122080845_takeoff_item_answers.sql). The takeoff journeys run one at a time: the activation is set aside again when
// the journey ends.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function activateOwnedItemListOrder() {
  assertOwnedCampaign();
  await querySql("insert into private.takeoff_item_list_order_activation (active_from) values (clock_timestamp()) on conflict do nothing;");
}

export async function deactivateOwnedItemListOrder() {
  assertOwnedCampaign();
  await querySql("delete from private.takeoff_item_list_order_activation;");
}

/** The countable rows of a job, with their ids: what a contribution's observation names (`takeoff_item_id`). */
export async function readOwnedPlanItemRows(jobId: string) {
  assertOwnedCampaign();
  if (!UUID.test(jobId)) throw new Error("Invalid fixture job.");
  // jsonb: one line, whatever the number of rows.
  const output = await querySql(`select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'designation', i.designation,
    'source_page', i.source_page) order by i.source_page, i.designation), '[]'::jsonb) from public.takeoff_items i
    where i.job_id = '${jobId}';`);
  return JSON.parse([...output].reverse().find((line) => line.trim().startsWith("[")) ?? "[]") as
    Array<{ id: string; designation: string; source_page: number }>;
}

/** The owner's tenant template « plomberie » made of these items alone, published as its administrator publishes it. */
export async function publishOwnedItemTemplate(setup: SupabaseClient, owner: WorkerOwner,
  items: Array<{ id: string; label: string; expectedUnit: string }>) {
  const shipped = PLUMBING_TEMPLATE.families.flatMap((family) => family.lines.map((line) => line.id));
  const definition = { contract: 1, title: "Plomberie", families: [{ id: "sanitaires", title: "Appareils sanitaires",
    lines: items.map((item) => ({ id: item.id, label: item.label, expectedUnit: item.expectedUnit, measurementBasis: null, qualifiers: {},
      synonyms: [] })) }] };
  const saved = await setup.rpc("save_takeoff_item_template_draft", { p_tenant_id: owner.tenantId, p_actor: owner.userId,
    p_template_key: "plomberie", p_expected_token: null, p_base_version: 1, p_definition: definition, p_shipped_line_ids: shipped });
  const token = (saved.data as Array<{ token: string }> | null)?.[0]?.token;
  if (saved.error || !token) throw new Error(`template draft: ${saved.error?.message ?? "no token"}`);
  const published = await setup.rpc("publish_takeoff_item_template", { p_tenant_id: owner.tenantId, p_actor: owner.userId,
    p_template_key: "plomberie", p_expected_token: token, p_intent_key: randomUUID(), p_shipped_line_ids: shipped });
  if (published.error) throw new Error(`template publication: ${published.error.message}`);
}

export type OwnedItemReading = { label: string; state: string; coverage: { expected: number; answered: number; inFlight: number; ended: number };
  readings: TakeoffItemPlanReading[] };

/** The affaire's items with their state, coverage and current answer on each plan, read with the owner's own session. */
export async function readOwnedItemReadings(owner: WorkerOwner, projectId: string): Promise<OwnedItemReading[]> {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const member = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await member.auth.signInWithPassword({ email: owner.email, password: owner.password });
  if (login.error) throw new Error("member login");
  try {
    const { data, error } = await member.rpc("read_takeoff_item_readings", { p_tenant_id: owner.tenantId, p_project_id: projectId,
      p_offset: 0, p_limit: 100 });
    if (error) throw new Error(`readings: ${error.message}`);
    const labels = JSON.parse((await querySql(`select coalesce(json_object_agg(e.item_id, e.label), '{}'::json)
      from public.takeoff_list_revision_entries e join public.takeoff_list_revisions r on r.id = e.revision_id
      where r.project_id = '${projectId}';`)).find((line) => line.trim().startsWith("{")) ?? "{}") as Record<string, string>;
    return ((data ?? []) as Array<{ item_id: string; state: string; expected: number; answered: number; in_flight: number; ended: number;
      readings: unknown[] }>).map((row) => ({ label: labels[row.item_id], state: row.state,
      coverage: { expected: row.expected, answered: row.answered, inFlight: row.in_flight, ended: row.ended },
      readings: (row.readings ?? []).map(parseTakeoffItemPlanReading) }));
  } finally {
    await member.auth.signOut();
  }
}
