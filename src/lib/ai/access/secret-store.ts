import "server-only";

import { spawn } from "node:child_process";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { ApiKeySecret } from "@/lib/ai/access/api-key-secret";

// Where a personal API key lives: the macOS Keychain of the Mac that runs the
// local server, through the system's own /usr/bin/security. No dependency, no
// native module: the item's access list trusts that tool, which is the only
// reader, so a Node upgrade never triggers a new Keychain prompt.
// - Read: `find-generic-password -w` prints the value on its standard output.
// - Write: `security -i` reads its command from standard input, so the value is
//   in no argument (visible to `ps`), no environment, no file. It travels as
//   hexadecimal (-X) and updates the item in place (-U). The interactive mode's
//   exit status does not prove the command ran: every write is read back.
// - The exit status of `security` is the low byte of the Keychain status:
//   44 item not found, 36 interaction not allowed (locked, no session),
//   51 authorization failed, 128 cancelled. Its messages are localized and
//   never read; its standard error is discarded.
// Elsewhere (Linux, a hosted server) there is no store: the key entry says it
// works on the Mac installation only. A plaintext fallback does not exist.

export type SecretItem = { service: string; account: string };

export class SecretStoreError extends Error {
  constructor(readonly reason: "locked" | "unavailable" | "failed") {
    super(`Secret store ${reason}.`);
    this.name = "SecretStoreError";
  }
}

export interface SecretStore {
  readonly kind: "macos-keychain" | "e2e-memory";
  /** Shown with the masked key: « Sur ce Mac ». */
  readonly placeLabel: string;
  read(item: SecretItem): Promise<ApiKeySecret | null>;
  write(item: SecretItem, secret: ApiKeySecret): Promise<void>;
  remove(item: SecretItem): Promise<void>;
}

export type SecurityRunResult = { code: number | null; stdout: string; timedOut: boolean; spawnFailed: boolean };
export type SecurityRun = (args: readonly string[], stdin: string | null, timeoutMs: number) => Promise<SecurityRunResult>;

const SECURITY = "/usr/bin/security";
/** An unlock dialog left open: the request answers « Déverrouillez le Trousseau » instead of hanging. */
const TIMEOUT_MS = 30_000;
const MAX_STDOUT = 64 * 1024;
const ITEM_WORD = /^[A-Za-z0-9._:-]{1,200}$/;
const LABEL = "MergeOne-OpenAI-API-key";
const LOCKED = new Set([36, 51, 128]);
const NOT_FOUND = 44;

/** The real process: a minimal environment, standard error discarded, killed at its deadline. */
const runSecurity: SecurityRun = (args, stdin, timeoutMs) => new Promise((resolve) => {
  let stdout = "";
  let settled = false;
  const finish = (result: SecurityRunResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const child = spawn(SECURITY, [...args], {
    // Only what the tool needs to find the member's login Keychain; nothing of the server's own environment.
    env: { NODE_ENV: process.env.NODE_ENV, HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", LOGNAME: process.env.LOGNAME ?? "",
      PATH: "/usr/bin:/bin", LANG: "C" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish({ code: null, stdout: "", timedOut: true, spawnFailed: false });
  }, timeoutMs);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length < MAX_STDOUT) stdout += chunk;
  });
  child.on("error", () => finish({ code: null, stdout: "", timedOut: false, spawnFailed: true }));
  child.on("close", (code: number | null) => finish({ code, stdout, timedOut: false, spawnFailed: false }));
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin ?? "");
});

function checkItem(item: SecretItem) {
  if (!ITEM_WORD.test(item.service) || !ITEM_WORD.test(item.account)) throw new SecretStoreError("failed");
}

function failureOf(result: SecurityRunResult): SecretStoreError {
  if (result.spawnFailed) return new SecretStoreError("unavailable");
  if (result.timedOut || (result.code !== null && LOCKED.has(result.code))) return new SecretStoreError("locked");
  return new SecretStoreError("failed");
}

export function createMacosKeychainStore(run: SecurityRun = runSecurity): SecretStore {
  async function read(item: SecretItem) {
    checkItem(item);
    const result = await run(["find-generic-password", "-s", item.service, "-a", item.account, "-w"], null, TIMEOUT_MS);
    if (result.code === NOT_FOUND) return null;
    if (result.code !== 0) throw failureOf(result);
    const secret = ApiKeySecret.fromStore(result.stdout.replace(/\n$/, ""));
    if (!secret) throw new SecretStoreError("failed");
    return secret;
  }
  return {
    kind: "macos-keychain",
    placeLabel: "Sur ce Mac",
    read,
    async write(item, secret) {
      checkItem(item);
      const hex = Buffer.from(secret.reveal("keychain-write"), "utf8").toString("hex");
      const result = await run(["-i"], `add-generic-password -U -s ${item.service} -a ${item.account} -l ${LABEL} -X ${hex}\n`, TIMEOUT_MS);
      if (result.timedOut || result.spawnFailed) throw failureOf(result);
      const stored = await read(item);
      if (!stored?.equals(secret)) throw new SecretStoreError("failed");
    },
    async remove(item) {
      checkItem(item);
      const result = await run(["delete-generic-password", "-s", item.service, "-a", item.account], null, TIMEOUT_MS);
      if (result.code === 0 || result.code === NOT_FOUND) return;
      throw failureOf(result);
    },
  };
}

// ---------------------------------------------------------------------------
// The TesterArmy journey's store. CI runs on Linux without a Keychain, so the
// journey's preload (e2e/army/local/api-key-provider-fixture.mjs, loaded with
// NODE_OPTIONS --import into its own development server) puts an in-memory
// store on this global. It is honoured only when all hold: not a production
// build, the local integration enabled (development, never CI), E2E_ARMY=1 —
// and the object exists, which takes code run inside the server process at
// its start. No setting turns it on, it writes nothing to disk, and it is gone
// when the process ends.

export const E2E_SECRET_STORE = Symbol.for("mergeone.e2e.aiSecretStore");

type MemoryStore = {
  kind: "e2e-memory";
  placeLabel: string;
  read: (service: string, account: string) => string | null;
  write: (service: string, account: string, value: string) => void;
  remove: (service: string, account: string) => void;
};

function isMemoryStore(value: unknown): value is MemoryStore {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MemoryStore>;
  return candidate.kind === "e2e-memory" && typeof candidate.placeLabel === "string" && typeof candidate.read === "function"
    && typeof candidate.write === "function" && typeof candidate.remove === "function";
}

function journeyStore(): SecretStore | null {
  if (process.env.NODE_ENV === "production" || process.env.E2E_ARMY !== "1" || !isLocalChatGptEnabled()) return null;
  const memory = (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE];
  if (!isMemoryStore(memory)) return null;
  return {
    kind: "e2e-memory",
    placeLabel: memory.placeLabel,
    async read(item) {
      checkItem(item);
      const value = memory.read(item.service, item.account);
      return value === null ? null : ApiKeySecret.fromStore(value);
    },
    async write(item, secret) {
      checkItem(item);
      memory.write(item.service, item.account, secret.reveal("keychain-write"));
    },
    async remove(item) {
      checkItem(item);
      memory.remove(item.service, item.account);
    },
  };
}

let keychain: SecretStore | null = null;

/** The store of this server, or null: the key entry is then unavailable, never degraded. */
export function resolveSecretStore(host: { platform: NodeJS.Platform } = { platform: process.platform }): SecretStore | null {
  const journey = journeyStore();
  if (journey) return journey;
  if (host.platform !== "darwin") return null;
  keychain ??= createMacosKeychainStore();
  return keychain;
}
