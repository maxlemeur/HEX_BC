import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../../src/types/database";
import { sqlTransport } from "../../../scripts/tester-army/calc-v3-fixtures";
import type { ArmyState } from "../critical/fixtures";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Privileged observation/clock fixture on this invocation's disposable stack only. */
async function ownedOffer(army: ArmyState, versionId: string) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const owner = army.ownedEstimates.find((item) => item.versionId === versionId);
  if (process.env.E2E_CALC_V3_OWNED_STACK !== "1" || backend.protocol !== "http:"
    || backend.hostname !== "127.0.0.1" || ["45585", "33485"].includes(backend.port)
    || !key || !owner || !/^ARMY-OFFER-[a-z0-9-]+$/i.test(army.runPrefix)) {
    throw new Error("Offer observation requires the exact owned ephemeral campaign.");
  }
  const admin = createClient<Database>(backend.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const version = await admin.from("estimate_versions").select("tenant_id,project_id").eq("id", versionId).single();
  if (version.error || version.data.project_id !== owner.projectId) throw new Error("Offer version ownership differs.");
  const project = await admin.from("estimate_projects").select("name,user_id").eq("id", owner.projectId).eq("tenant_id", version.data.tenant_id).single();
  if (project.error || !project.data.name.startsWith(`${army.runPrefix}-`)) throw new Error("Offer project ownership differs.");
  return { admin, tenantId: version.data.tenant_id, projectId: owner.projectId, ownerId: project.data.user_id };
}

export async function observeOwnedOffer(army: ArmyState, versionId: string) {
  const { admin, tenantId } = await ownedOffer(army, versionId);
  const dispatches = await admin.from("estimate_emails")
    .select("id,status,provider_id,request_id,idempotency_key,document_sha256,provider_payload_hash,attempt_count,last_error_code")
    .eq("tenant_id", tenantId).eq("version_id", versionId).order("created_at");
  const capabilities = await admin.from("portal_tokens").select("id,status,expires_at,estimate_email_dispatch_id")
    .eq("tenant_id", tenantId).eq("version_id", versionId).order("created_at");
  if (dispatches.error || capabilities.error) throw new Error("Owned offer persisted observation failed.");
  return {
    observation: "privileged read of the owned local fixture; not authorization proof",
    dispatches: dispatches.data.map(({ request_id, idempotency_key, ...row }) => ({ ...row,
      requestSha256: request_id ? digest(request_id) : null,
      providerKeySha256: idempotency_key ? digest(idempotency_key) : null,
    })),
    capabilities: capabilities.data,
  };
}

/** Age the one real collected capability; never seed a decision or a sent offer. */
export async function expireOwnedCollectedPortal(army: ArmyState, versionId: string, portalUrl: string) {
  const { admin, tenantId, projectId, ownerId } = await ownedOffer(army, versionId);
  const url = new URL(portalUrl);
  const capability = url.pathname.match(/^\/portal\/([a-f0-9-]{36})$/i)?.[1];
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (url.origin !== process.env.E2E_OFFER_APP_ORIGIN || url.search || url.hash || url.username || url.password || !capability ||
    ![capability, versionId, tenantId, projectId, ownerId].every((id) => uuid.test(id))) throw new Error("Collected portal origin or owned identities differ.");
  const before = await admin.from("portal_tokens").select("id,status,expires_at")
    .eq("tenant_id", tenantId).eq("version_id", versionId).eq("token", capability).eq("status", "pending")
    .single();
  if (before.error || !uuid.test(before.data.id) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(before.data.expires_at) ||
    !Number.isFinite(Date.parse(before.data.expires_at)) || Date.parse(before.data.expires_at) <= Date.now()) throw new Error("Owned portal clock requires one real pending, unexpired capability.");
  // Preserve PostgreSQL microseconds for the exact compare-and-set predicate.
  const previousExpiresAt = before.data.expires_at;
  const expiresAt = "2000-01-01T00:00:00.000Z";
  const transport = sqlTransport({ backend: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    databaseUrl: process.env.E2E_ARMY_LOCAL_DB_URL ?? "", psql: process.env.E2E_ARMY_LOCAL_PSQL ?? "" });
  // Production capabilities deliberately forbid expiry rewrites, even for the
  // service role. Move this one owned clock under the native fixture owner;
  // transactional DDL restores the exact trigger on success and rollback.
  const result = spawnSync(transport.executable, [...transport.args, "-v", "VERBOSITY=sqlstate"], {
    env: transport.env, encoding: "utf8", timeout: 20_000, maxBuffer: 16_384,
    input: `BEGIN;
DO $clock$ DECLARE matches integer; BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR NOT EXISTS (
    SELECT 1 FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id=v.project_id AND p.tenant_id=v.tenant_id
    WHERE v.id='${versionId}'::uuid AND v.tenant_id='${tenantId}'::uuid AND p.id='${projectId}'::uuid
      AND p.user_id='${ownerId}'::uuid AND p.name LIKE '${army.runPrefix}-%')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.portal_tokens'::regclass
      AND tgname='aaa_guard_estimate_offer_token' AND tgenabled='O')
    THEN RAISE EXCEPTION 'ARMY_PORTAL_CLOCK_SCOPE'; END IF;
  ALTER TABLE public.portal_tokens DISABLE TRIGGER aaa_guard_estimate_offer_token;
  UPDATE public.portal_tokens SET expires_at='${expiresAt}'::timestamptz
    WHERE id='${before.data.id}'::uuid AND tenant_id='${tenantId}'::uuid AND version_id='${versionId}'::uuid
      AND token='${capability}'::uuid AND status='pending' AND expires_at='${previousExpiresAt}'::timestamptz;
  GET DIAGNOSTICS matches=ROW_COUNT;
  IF matches<>1 THEN RAISE EXCEPTION 'ARMY_PORTAL_CLOCK_ROW_COUNT'; END IF;
  ALTER TABLE public.portal_tokens ENABLE TRIGGER aaa_guard_estimate_offer_token;
END $clock$;
SELECT json_build_object('id',id,'status',status,'previousExpiresAt','${previousExpiresAt}','expiresAt',expires_at,
  'triggerEnabled',(SELECT tgenabled='O' FROM pg_catalog.pg_trigger WHERE tgrelid='public.portal_tokens'::regclass AND tgname='aaa_guard_estimate_offer_token'))
FROM public.portal_tokens WHERE id='${before.data.id}'::uuid AND tenant_id='${tenantId}'::uuid AND version_id='${versionId}'::uuid;
COMMIT;`,
  });
  if (result.status !== 0 || result.error) throw new Error("Owned portal expiry clock transaction failed; no successful expiry claim.");
  const receipt = JSON.parse(result.stdout.trim()) as { id: string; status: string; previousExpiresAt: string; expiresAt: string; triggerEnabled: boolean };
  if (receipt.id !== before.data.id || receipt.status !== "pending" || receipt.previousExpiresAt !== previousExpiresAt ||
    Date.parse(receipt.expiresAt) !== Date.parse(expiresAt) || receipt.triggerEnabled !== true) throw new Error("Owned portal expiry clock readback differs.");
  return receipt;
}
