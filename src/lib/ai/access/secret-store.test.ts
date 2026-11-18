import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { ApiKeySecret } from "@/lib/ai/access/api-key-secret";
import {
  createMacosKeychainStore, E2E_SECRET_STORE, resolveSecretStore, SecretStoreError, type SecurityRun, type SecurityRunResult,
} from "@/lib/ai/access/secret-store";

// The macOS Keychain through /usr/bin/security, with the process injected: no
// real Keychain is read or written here. Failure modes, written first:
// - the secret reaches a command's arguments or its environment (visible to
//   `ps` and to every child), instead of the process's standard input;
// - a write reported as done although the item holds another value (the
//   interactive mode's exit status does not prove the command ran);
// - a locked Keychain, or an unlock dialog nobody answers, reported as a
//   missing key or hanging the request;
// - a test store that an ordinary installation could switch on;
// - the secret printed by a log, a JSON response or util.inspect.

const ITEM = { service: "fr.mergeone.ai-api-key", account: "11111111-1111-4111-8111-111111111111:user-1:tenant-1:openai" };
const KEY = `sk-proj-${"Ab3_".repeat(12)}7K2F`;

function fakeSecurity(script: (args: readonly string[], stdin: string | null) => Partial<SecurityRunResult>) {
  const calls: Array<{ args: readonly string[]; stdin: string | null; timeoutMs: number }> = [];
  const run: SecurityRun = async (args, stdin, timeoutMs) => {
    calls.push({ args, stdin, timeoutMs });
    return { code: 0, stdout: "", timedOut: false, spawnFailed: false, ...script(args, stdin) };
  };
  return { run, calls };
}

/** A fake Keychain: what `add-generic-password -X` wrote is what `find-generic-password -w` reads. */
function keychainBackedSecurity(options: { readCode?: number; writeIgnored?: boolean } = {}) {
  let stored: string | null = null;
  return fakeSecurity((args, stdin) => {
    if (args[0] === "-i") {
      const hex = /-X ([0-9a-f]+)\n$/.exec(stdin ?? "")?.[1];
      if (hex && !options.writeIgnored) stored = Buffer.from(hex, "hex").toString("utf8");
      return { code: 0 };
    }
    if (args[0] === "find-generic-password") {
      if (options.readCode !== undefined) return { code: options.readCode };
      return stored === null ? { code: 44 } : { code: 0, stdout: `${stored}\n` };
    }
    if (args[0] === "delete-generic-password") {
      const had = stored !== null;
      stored = null;
      return { code: had ? 0 : 44 };
    }
    return { code: 1 };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE];
});

describe("ApiKeySecret", () => {
  it("accepts an OpenAI key, trimmed, and refuses anything that could break a command line", () => {
    expect(ApiKeySecret.parseOpenAi(`  ${KEY}\n`).suffix).toBe("7K2F");
    for (const bad of ["", "sk-", "pk-live-abcdefghijklmnopqrstuvwxyz", `${KEY} -A`, `${KEY}\n-U`, `sk-"${"a".repeat(30)}`, 42]) {
      expect(() => ApiKeySecret.parseOpenAi(bad)).toThrow(ApiKeyError);
    }
  });

  it("never prints its value", () => {
    const secret = ApiKeySecret.parseOpenAi(KEY);
    const shown = [String(secret), `${secret}`, JSON.stringify({ secret }), inspect(secret), inspect({ nested: [secret] }, { depth: 5 })];
    for (const text of shown) expect(text).not.toContain(KEY);
  });
});

describe("macOS Keychain store", () => {
  it("writes through standard input only, then reads the item back", async () => {
    const security = keychainBackedSecurity();
    const store = createMacosKeychainStore(security.run);
    await store.write(ITEM, ApiKeySecret.parseOpenAi(KEY));
    const [write, readBack] = security.calls;
    expect(write.args).toEqual(["-i"]);
    expect(write.args.join(" ")).not.toContain(KEY);
    // Hexadecimal data, update in place, the creating tool (not « any application ») trusted.
    expect(write.stdin).toBe(`add-generic-password -U -s ${ITEM.service} -a ${ITEM.account} -l MergeOne-OpenAI-API-key -X ${Buffer.from(KEY).toString("hex")}\n`);
    expect(write.stdin).not.toContain(" -A");
    expect(write.stdin).not.toContain(KEY);
    expect(readBack.args).toEqual(["find-generic-password", "-s", ITEM.service, "-a", ITEM.account, "-w"]);
    expect((await store.read(ITEM))?.suffix).toBe("7K2F");
    for (const call of security.calls) expect(call.args.join(" ")).not.toContain(KEY);
  });

  it("reports a write the Keychain did not keep as a failure, not a success", async () => {
    const store = createMacosKeychainStore(keychainBackedSecurity({ writeIgnored: true }).run);
    await expect(store.write(ITEM, ApiKeySecret.parseOpenAi(KEY))).rejects.toMatchObject({ reason: "failed" });
  });

  it("tells a missing item from a locked Keychain or an unanswered unlock dialog", async () => {
    expect(await createMacosKeychainStore(keychainBackedSecurity().run).read(ITEM)).toBeNull();
    for (const code of [36, 51, 128]) {
      await expect(createMacosKeychainStore(keychainBackedSecurity({ readCode: code }).run).read(ITEM)).rejects.toMatchObject({ reason: "locked" });
    }
    const unanswered = createMacosKeychainStore(fakeSecurity(() => ({ code: null, timedOut: true })).run);
    await expect(unanswered.read(ITEM)).rejects.toMatchObject({ reason: "locked" });
    const missingTool = createMacosKeychainStore(fakeSecurity(() => ({ code: null, spawnFailed: true })).run);
    await expect(missingTool.read(ITEM)).rejects.toMatchObject({ reason: "unavailable" });
    await expect(createMacosKeychainStore(keychainBackedSecurity({ readCode: 9 }).run).read(ITEM)).rejects.toBeInstanceOf(SecretStoreError);
  });

  it("removes an item, and accepts one already gone", async () => {
    const security = keychainBackedSecurity();
    const store = createMacosKeychainStore(security.run);
    await store.write(ITEM, ApiKeySecret.parseOpenAi(KEY));
    await store.remove(ITEM);
    await store.remove(ITEM);
    expect(await store.read(ITEM)).toBeNull();
  });

  it("refuses an item identity that could inject words into the interactive command", async () => {
    const security = keychainBackedSecurity();
    const store = createMacosKeychainStore(security.run);
    await expect(store.write({ ...ITEM, account: "a -A" }, ApiKeySecret.parseOpenAi(KEY))).rejects.toMatchObject({ reason: "failed" });
    expect(security.calls).toEqual([]);
  });
});

describe("store resolution", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { kind: "e2e-memory", placeLabel: "Trousseau de test",
      read: (service: string, account: string) => values.get(`${service}\u0000${account}`) ?? null,
      write: (service: string, account: string, value: string) => { values.set(`${service}\u0000${account}`, value); },
      remove: (service: string, account: string) => { values.delete(`${service}\u0000${account}`); } };
  };

  it("uses the Keychain on macOS and nothing elsewhere: no weaker store", () => {
    expect(resolveSecretStore({ platform: "darwin" })?.kind).toBe("macos-keychain");
    expect(resolveSecretStore({ platform: "linux" })).toBeNull();
    expect(resolveSecretStore({ platform: "win32" })).toBeNull();
  });

  it("takes the journey's in-memory store only in a local Army development server", () => {
    (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE] = memory();
    // An ordinary local installation: the injected object alone is not enough.
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveSecretStore({ platform: "linux" })).toBeNull();
    vi.stubEnv("E2E_ARMY", "1");
    expect(resolveSecretStore({ platform: "linux" })?.kind).toBe("e2e-memory");
    // Never in a production build, whatever the environment says.
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveSecretStore({ platform: "linux" })).toBeNull();
    expect(resolveSecretStore({ platform: "darwin" })?.kind).toBe("macos-keychain");
    // Nor in a CI test process.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CI", "1");
    expect(resolveSecretStore({ platform: "linux" })).toBeNull();
  });

  it("ignores an injected object that is not a store", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_ARMY", "1");
    (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE] = { kind: "e2e-memory" };
    expect(resolveSecretStore({ platform: "linux" })).toBeNull();
  });
});
