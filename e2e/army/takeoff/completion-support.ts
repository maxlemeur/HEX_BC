import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";

import { expect } from "e2e";

import { querySql } from "../local/calculation-gate-support";
import type { WorkerUi } from "./worker-support";

type Message = { from?: string; to?: string; cc?: unknown; attachments?: unknown; subject?: string; text?: string };

export async function startTakeoffEmailCollector(options: { loseFirstResponse?: boolean } = {}) {
  const receipts = new Map<string, { id: string; message: Message }>();
  let requests = 0;
  const server = createServer(async (request, response) => {
    try {
      const key = request.headers["idempotency-key"];
      if (request.method !== "POST" || request.url !== "/emails" || typeof key !== "string"
        || request.headers.authorization !== "Bearer LOCAL_ONLY_INVALID_RESEND_SENTINEL") {
        response.writeHead(403).end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 8_192) throw new Error("Unexpected email size.");
      }
      const message = JSON.parse(body) as Message;
      requests += 1;
      const receipt = receipts.get(key) ?? { id: randomUUID(), message };
      if (JSON.stringify(receipt.message) !== JSON.stringify(message)) {
        response.writeHead(409, { "Content-Type": "application/json" })
          .end(JSON.stringify({ name: "invalid_idempotent_request", message: "Changed fixture envelope." }));
        return;
      }
      receipts.set(key, receipt);
      if (options.loseFirstResponse && requests === 1) {
        response.destroy();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: receipt.id }));
    } catch {
      response.writeHead(422).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The email fixture needs its own loopback port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    receipts,
    get requests() { return requests; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export async function activateOwnedTakeoffNotices() {
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || process.env.E2E_ARMY_BLOCK_WORKERS !== "1") {
    throw new Error("The takeoff notice fixture requires a dedicated owned worker campaign.");
  }
  await querySql("insert into private.takeoff_completion_activation (active_from) values (clock_timestamp()) on conflict do nothing;");
}

export async function readOwnedTakeoffNotice(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error("Invalid takeoff fixture job ID.");
  const rows = await querySql(`select json_build_object(
    'id', n.id, 'outcome', n.outcome, 'deliveryState', n.delivery_state, 'isRead', n.read_at is not null)
    from public.takeoff_completion_notifications n where n.subject_kind = 'job' and n.job_id = '${jobId}'`);
  if (rows.length > 1) throw new Error("A job published more than one notice.");
  return rows[0] ? JSON.parse(rows[0]) as {
    id: string; outcome: string; deliveryState: string; isRead: boolean;
  } : undefined;
}

export async function openWorkerNotice(ui: WorkerUi, jobId: string) {
  await ui.browser.setViewport({ width: 1280, height: 844 });
  await ui.screen.getByRole("menuitem", "Autres pages Affaires", { exact: true }).click();
  await ui.screen.getByRole("menuitem", "Notifications", { exact: true }).click();
  await expect(ui.screen.getByRole("heading", "Notifications", { exact: true })).toBeVisible();
  return ui.browser.locator(`li[id="${jobId}"]`);
}
