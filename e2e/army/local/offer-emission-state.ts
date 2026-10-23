import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../../src/types/database";
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
  const project = await admin.from("estimate_projects").select("name").eq("id", owner.projectId).eq("tenant_id", version.data.tenant_id).single();
  if (project.error || !project.data.name.startsWith(`${army.runPrefix}-`)) throw new Error("Offer project ownership differs.");
  return { admin, tenantId: version.data.tenant_id };
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
  const { admin, tenantId } = await ownedOffer(army, versionId);
  const url = new URL(portalUrl);
  const capability = url.pathname.match(/^\/portal\/([a-f0-9-]{36})$/i)?.[1];
  if (url.origin !== process.env.E2E_OFFER_APP_ORIGIN || !capability) throw new Error("Collected portal origin differs.");
  const updated = await admin.from("portal_tokens").update({ expires_at: "2000-01-01T00:00:00.000Z" })
    .eq("tenant_id", tenantId).eq("version_id", versionId).eq("token", capability).eq("status", "pending")
    .select("id,status,expires_at").single();
  if (updated.error || updated.data.status !== "pending") throw new Error("Owned portal expiry clock fixture failed.");
  return { id: updated.data.id, status: updated.data.status, expiresAt: updated.data.expires_at };
}
