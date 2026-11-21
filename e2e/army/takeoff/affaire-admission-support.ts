import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { expect } from "e2e";

import { deriveDeterministicJobId } from "@/lib/takeoff/job-creation-input";
import { holdSharedCalculationGate, querySql } from "../local/calculation-gate-support";
import type { WorkerOwner } from "./worker-support";

const run = promisify(execFile);
type Admission = { receipt?: { id: string; status: string; estimate_version_id: string | null; project_id?: string }; rejected?: string };

export function startOwnedTakeoffAdmission(owner: WorkerOwner, runPrefix: string, projectId: string, planSetId: string, operationId: string,
  preparationRevision = 1) {
  const names = ["PATH", "TMPDIR", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_ALLOWED_SUPABASE_HOST", "E2E_ARMY_BASE_URL", "E2E_ARMY_BLOCK_WORKERS",
    "E2E_COVERAGE_BACKEND_ORIGIN", "E2E_COVERAGE_NETWORK_LOG",
    "E2E_ARMY_TAKEOFF_WORKER", "TAKEOFF_MODULE_ENABLED_BY_DEFAULT"];
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(names.map(name => [name, process.env[name]])), NODE_ENV: "test", MERGEONE_CHATGPT_LOCAL: "1",
    E2E_LOGIN_EMAIL: owner.email, E2E_LOGIN_PASSWORD: owner.password };
  const result = run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/tester-army/takeoff-admit.mjs",
    projectId, planSetId, operationId, runPrefix, String(preparationRevision)], { env, timeout: 40_000 });
  const done = result.then(({ stdout, stderr }) => {
    const line = stdout.split("\n").find(line => line.startsWith("ARMY_ADMISSION "));
    if (!line) throw new Error(`Missing owned admission result: ${stderr.slice(-1200)}`);
    return JSON.parse(line.slice("ARMY_ADMISSION ".length)) as Admission;
  });
  return { done, interrupt: () => result.child.kill("SIGKILL") };
}

export async function assertOwnedAdmissionRecovery(owner: WorkerOwner, start: (operationId: string) => ReturnType<typeof startOwnedTakeoffAdmission>) {
  for (const mode of ["audit_rejection", "interrupted"] as const) {
    const operation = randomUUID();
    const jobId = deriveDeterministicJobId(owner.tenantId, `takeoff-affaire:${operation}`);
    const suffix = jobId.replaceAll("-", "");
    const seq = `public.army_admission_seq_${suffix}`;
    const hook = `army_admission_${suffix}`;
    await querySql(`create sequence ${seq};
      create function public.${hook}() returns trigger language plpgsql set search_path = '' as $$
      begin
        if new.record_id = '${jobId}' and new.action = 'takeoff.job.created' and nextval('${seq}') = 1 then
          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:${owner.tenantId}', 0));
          raise exception 'ARMY controlled audit rejection';
        end if;
        return new;
      end $$;
      create trigger ${hook} before insert on public.audit_logs for each row execute function public.${hook}();`);
    const gate = await holdSharedCalculationGate(owner.tenantId, mode);
    const state = () => querySql(`select count(*) from public.takeoff_jobs where id = '${jobId}';
      select count(*) from public.audit_logs where record_id = '${jobId}' and action = 'takeoff.job.created';`);
    const first = start(operation);
    // Keep the promise observed even if setup or an assertion fails.
    void first.done.catch(() => undefined);
    try {
      let pid: string | undefined;
      const deadline = Date.now() + 15_000;
      while (!pid && Date.now() < deadline) {
        [pid] = await querySql(`select l.pid from pg_catalog.pg_locks l
          join pg_catalog.pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and l.locktype = 'advisory' and not l.granted
            and ((l.classid::bigint << 32) | l.objid::bigint) = pg_catalog.hashtextextended('estimate-calculation:${owner.tenantId}', 0);`);
        if (!pid) await setTimeout(100);
      }
      if (!pid || !/^\d+$/.test(pid)) throw new Error(`Admission did not reach the audit barrier: ${JSON.stringify(await first.done)}`);
      const whileBlocked = await state();
      if (mode === "audit_rejection") {
        const replay = start(operation).done;
        void replay.catch(() => undefined);
        const beforeRelease = await Promise.race([replay, (async () => {
          while (Date.now() < deadline) {
            const [waiting] = await querySql(`select count(*) from pg_catalog.pg_stat_activity where ${pid} = any(pg_blocking_pids(pid));`);
            if (waiting !== "0") return null;
            await setTimeout(100);
          }
          throw new Error("Replay did not reach the first admission's transaction.");
        })()]);
        await gate.release();
        expect((await first.done).rejected).toBeTruthy();
        const replayed = await replay;
        expect(beforeRelease).toBeNull();
        expect(whileBlocked).toEqual(["0", "0"]);
        expect(replayed.receipt?.id).toEqual(jobId);
      } else {
        expect(first.interrupt()).toBe(true);
        expect(await first.done.then(() => false, () => true)).toBe(true);
        await querySql(`select pg_cancel_backend(${pid});`);
        await gate.release();
        expect(whileBlocked).toEqual(["0", "0"]);
        expect(await state()).toEqual(["0", "0"]);
        expect((await start(operation).done).receipt?.id).toEqual(jobId);
      }
      expect(await state()).toEqual(["1", "1"]);
    } finally {
      await gate.release();
      await first.done.catch(() => undefined);
      await querySql(`drop trigger ${hook} on public.audit_logs; drop function public.${hook}(); drop sequence ${seq};`);
    }
  }
}
