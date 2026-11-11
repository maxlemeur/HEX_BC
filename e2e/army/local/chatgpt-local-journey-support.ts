import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { LAB_DATASET_LAYOUT } from "@/lib/takeoff/lab/contracts";
import { createLocalChatGptOwner, prepareChatGptServerWorkspace, warmChatGptServer } from "./chatgpt-server-support";
import { buildLabVectorPlanPdf } from "./lab-vector-plan-fixture";

// The development server of the ChatGPT local journeys, shared by chatgpt-local-takeoff.e2e.ts and
// chatgpt-local-decisions.e2e.ts. They were one file until its tests, run one after another on that server, made
// their shard twice as long as the others (15 minutes, run 42913532135): each file now starts its own server, owner
// account, port, Next workspace and artifacts directory, so the shard plan can run them in two jobs.
// Two of these servers must not compile at once on one machine: scripts/tester-army/army-shards.json (neverTogether)
// keeps the two files in different shards and refuses them together in a run of several workers.

// Explicit opt-in for an owner-authorized live probe on the disposable backend.
// The private file contains only a short-lived access token, never refresh/ID tokens.
export const liveProbePath = path.resolve(".private/chatgpt-local-live-probe.json");
export type ChatGptLiveProbe = { accessToken: string; model: string; expiresAt: number; reasoningEffort?: string | null };

/** The fictional layered plan of the takeoff lab dataset each server reads (VEC01). */
export const LAB_VECTOR_DOCUMENT = "fictif-plan-calques";

/** The fixture also logs a client that left a proxied request; the server absorbs it and keeps serving (TI-667). */
export const isAbsorbedClientAbort = (entry: Record<string, unknown>) => entry.provider === "process-diagnostic"
  && entry.kind === "uncaught" && entry.nodeCode === "ECONNRESET" && entry.messageKind === "aborted";

export type ChatGptLocalServer = {
  origin: string;
  /** The owner account created for this server; its tenant belongs to this journey file alone. */
  email: string;
  liveProbe: ChatGptLiveProbe | null;
  transportLog: string;
  decisionsControl: string;
  labOutputDir: string;
  workspace: { id: string };
  /** The last 100 chunks the server wrote, OAuth codes redacted; the same array for the server's whole life. */
  diagnostics: readonly string[];
};

export async function localChatGptClient(email: string) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("ChatGPT fixture login failed.");
  return { client, userId: login.data.user!.id };
}

export async function writeDecisionsControl(decisionsControl: string, input: { hold?: boolean; timeoutWriting?: boolean }) {
  const temporary = `${decisionsControl}.tmp`;
  await writeFile(temporary, JSON.stringify({ hold: false, timeoutWriting: false, ...input }));
  await rename(temporary, decisionsControl);
}

/** Writes the owner's temporary ChatGPT profile, which must not exist yet, and returns its private path. */
export async function writePlanFixture(email: string, liveProbe: ChatGptLiveProbe | null, unsetPreferences: boolean) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) throw new Error("Owned local backend required.");
  const client = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  expect(login.error).toBeNull();
  const userId = login.data.user!.id;
  const membership = await client.from("tenant_memberships").select("tenant_id, tenants!inner(is_active)").eq("user_id", userId)
    .eq("tenants.is_active", true).order("is_default", { ascending: false }).order("created_at").limit(1).single();
  expect(membership.error).toBeNull();
  const tenantId = membership.data!.tenant_id;
  const key = createHash("sha256").update(JSON.stringify([userId, tenantId])).digest("hex");
  const directory = path.resolve(".private/chatgpt-local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${key}.json`);
  const id = randomUUID();
  const model = unsetPreferences ? null : liveProbe?.model ?? "army-plan-model";
  await writeFile(file, JSON.stringify({ selectedId: id, profiles: [{ id, clientId: "army-fixture", issuer: "https://auth.openai.com",
    subject: "army-fixture", email: "fixture@example.test", model,
    reasoningEffort: unsetPreferences ? null : liveProbe?.reasoningEffort ?? null, accessToken: liveProbe?.accessToken ?? "army-chatgpt-fixture",
    expiresAt: liveProbe?.expiresAt ?? Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] }] }), { mode: 0o600, flag: "wx" });
  return file;
}

/**
 * One journey file's development server: `start` in its beforeAll, `stop` in its afterAll. Call it once per journey
 * module: the state lives in the returned object, so a module the runner imports again starts from nothing.
 * `workflow` names the journey file, whose routes the readiness compiles (warmChatGptServer).
 */
export function chatGptLocalServer(workflow: "decisions" | "takeoff") {
  let localServer: ChildProcess | undefined;
  let localOrigin: string | undefined;
  let transportLog: string | undefined;
  let serverWorkspace: Awaited<ReturnType<typeof prepareChatGptServerWorkspace>> | undefined;
  const diagnostics: string[] = [];

  async function start(): Promise<ChatGptLocalServer> {
    // Use the campaign's disposable local backend, never ambient .env credentials.
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(backend.hostname)) throw new Error("Local backend required.");
    const liveProbe: ChatGptLiveProbe | null = await readFile(liveProbePath, "utf8").then((text) => JSON.parse(text)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw new Error("Invalid live probe configuration.");
    });
    if (liveProbe && (!liveProbe.accessToken || !liveProbe.model || liveProbe.expiresAt < Date.now() + 300_000)) {
      throw new Error("Live probe requires a selected model and a valid short-lived token.");
    }
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Port reservation failed.");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = localOrigin = `http://127.0.0.1:${port}`;
    const email = (await createLocalChatGptOwner()).email;
    const workspace = serverWorkspace = await prepareChatGptServerWorkspace();
    const artifacts = path.resolve(".e2e/army/critical/artifacts", workspace.id);
    const log = transportLog = path.join(artifacts, "chatgpt-transport.jsonl");
    const decisionsControl = path.join(artifacts, "decisions-control.json");
    await mkdir(path.dirname(log), { recursive: true });
    await writeFile(log, "");
    await writeDecisionsControl(decisionsControl, {});
    // The takeoff lab of VEC01: a fictional dataset of one layered plan, and an empty output, under this run's artifacts.
    const labDatasetDir = path.join(artifacts, "lab-dataset");
    const labOutputDir = path.join(artifacts, "lab-output");
    const labPdf = path.join(labDatasetDir, LAB_DATASET_LAYOUT.raw(LAB_VECTOR_DOCUMENT));
    await mkdir(path.dirname(labPdf), { recursive: true });
    await mkdir(labOutputDir, { recursive: true, mode: 0o700 });
    const labBytes = await buildLabVectorPlanPdf();
    await writeFile(labPdf, labBytes);
    await writeFile(path.join(labDatasetDir, LAB_DATASET_LAYOUT.manifest), JSON.stringify({ schema_version: 1, documents: [{
      id: LAB_VECTOR_DOCUMENT, file_type: "pdf", raw_status: "binary", raw_path: LAB_DATASET_LAYOUT.raw(LAB_VECTOR_DOCUMENT), file_size: labBytes.length,
      sha256: createHash("sha256").update(labBytes).digest("hex"), pages: 1, kind: "plan", role: "truth",
    }] }));
    const child = localServer = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port), "--webpack"], {
      cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development", ...workspace.environment,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/chatgpt-provider-fixture.mjs")).href}`,
        ARMY_CHATGPT_TRANSPORT_LOG: log, GEMINI_API_KEY: "army-disabled-provider-fixture", TAKEOFF_WORKER_SECRET: "army-worker-fixture",
        TAKEOFF_LAB_DATASET_DIR: labDatasetDir, TAKEOFF_LAB_OUTPUT_DIR: labOutputDir,
        ...(!liveProbe ? { MERGEONE_OPENAI_DECISIONS: "1", MERGEONE_TAKEOFF_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "army-decisions-fixture", ARMY_DECISIONS_CONTROL: decisionsControl } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => {
      diagnostics.push(String(chunk).replace(/code=[^&\s]+/g, "code=[redacted]"));
      if (diagnostics.length > 100) diagnostics.shift();
    });
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error("ChatGPT local server exited before readiness.");
      return fetch(`${origin}/favicon.ico`).then((response) => response.ok).catch(() => false);
    }, { timeout: 90_000 }).toBe(true);
    await workspace.assertReady();
    await warmChatGptServer(origin, email, workflow);
    return { origin, email, liveProbe, transportLog: log, decisionsControl, labOutputDir, workspace, diagnostics };
  }

  /** Stops the server, then removes the temporary ChatGPT profile a test left, if any, and keeps the server's timings. */
  async function stop(planFixture?: string) {
    const child = localServer;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    if (planFixture) await rm(planFixture, { force: true });
    if (localOrigin && transportLog) {
      // Keep only compilation/readiness and non-sensitive dashboard/login timings.
      const timings = diagnostics.join("").split("\n").filter(line =>
        /(?:Compiling|Ready in|Local Next process exited|restarting|Restarting|FATAL ERROR|heap limit|allocation failed|worker.*exited|SIGKILL|ENOMEM|out of memory|(?:GET|POST) \/(?:dashboard|login)(?:[/? ]))/.test(line))
        .map(line => line.replace(/(\/(?:dashboard|login)[^?\s]*)\?[^\s]*/g, "$1?[redacted]"));
      await mkdir(path.dirname(transportLog), { recursive: true });
      await writeFile(path.join(path.dirname(transportLog), `chatgpt-local-server-${new URL(localOrigin).port}.log`), timings.join("\n"));
    }
    await serverWorkspace?.cleanup();
  }

  return { start, stop };
}
