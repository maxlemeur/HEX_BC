import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sqlTransport, type CalcV3FixtureContext } from "./calc-v3-fixtures";

function sql(context: CalcV3FixtureContext, input: string) {
  const transport = sqlTransport(context);
  const result = spawnSync(transport.executable, transport.args, { env: transport.env, input, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error("Owned atomic-fault SQL failed; no retry, no shared database permitted.");
  return result.stdout.trim();
}

export function installGeneratedAtomicFault(context: CalcV3FixtureContext, versions: string[]) {
  if (versions.length !== 2 || new Set(versions).size !== 2 || versions.some((id) => !/^[0-9a-f-]{36}$/u.test(id))) throw new Error("Two owned atomic witness IDs required.");
  const name = `army_wfc_${randomUUID().replaceAll("-", "")}`;
  const ids = versions.map((id) => `'${id}'::uuid`).join(",");
  const output = sql(context, `BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR
    (SELECT count(*) FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id=v.project_id
     WHERE v.id IN (${ids}) AND v.tenant_id='${context.owner.tenantId}'::uuid
       AND p.user_id='${context.owner.userId}'::uuid AND p.name LIKE 'ARMY-GENERATED-ATOMIC-%') <> 2
    THEN RAISE EXCEPTION 'ARMY_ATOMIC_OWNER_DIFFERS'; END IF;
END $guard$;
CREATE SEQUENCE private.${name};
REVOKE ALL ON SEQUENCE private.${name} FROM public,anon,authenticated;
CREATE FUNCTION private.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fault$
BEGIN
  IF new.version_id IN (${ids}) THEN
    PERFORM nextval('private.${name}'::regclass);
    RAISE EXCEPTION USING errcode='PWF02', message='ARMY_GENERATED_NATIVE_LATE_FAULT';
  END IF;
  RETURN new;
END $fault$;
REVOKE ALL ON FUNCTION private.${name}() FROM public,anon,authenticated;
CREATE TRIGGER ${name} BEFORE INSERT ON private.generated_ouvrage_application_receipts FOR EACH ROW EXECUTE FUNCTION private.${name}();
COMMIT;
SELECT 'ARMY_ATOMIC_FAULT_INSTALLED';`);
  if (!output.endsWith("ARMY_ATOMIC_FAULT_INSTALLED")) throw new Error("Atomic fault installation was not confirmed.");
  return { sequence: name, versions, sqlstate: "PWF02", table: "private.generated_ouvrage_application_receipts", cleanup: "destroyed with ephemeral stack" };
}

export function readGeneratedAtomicFault(context: CalcV3FixtureContext, name: string, expectedHits?: number) {
  if (!/^army_wfc_[a-f0-9]{32}$/u.test(name)) throw new Error("Invalid atomic fault identity.");
  const hits = Number(sql(context, `SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM private.${name};`));
  if (!Number.isSafeInteger(hits) || hits < 0 || (expectedHits !== undefined && hits !== expectedHits)) {
    throw new Error(`Atomic late-fault hits ${hits}, expected ${expectedHits ?? "nonnegative integer"}.`);
  }
  return { hits, expectedHits: expectedHits ?? null, sqlstate: "PWF02" };
}
