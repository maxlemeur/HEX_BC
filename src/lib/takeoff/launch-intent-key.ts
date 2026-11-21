/**
 * A member's manual launch command on an affaire (`launchTakeoffRelaunch`) whose answer is unknown: a lost answer, a
 * server error. The browser keeps it, one per member and affaire, until an answer arrives, across a reload and for every
 * tab: the member's next click on that affaire sends that command again (its key and its own content) before anything
 * new, so its replay finds its receipt instead of paying a second analysis, even after its analysis finished and the
 * affaire offers to relaunch it. An answer, a success or a refusal the server named, ends it for every tab: a settled key
 * is never sent again. The entry's name is a digest of the tenant, the member and the affaire.
 */
export type TakeoffLaunchScope = { tenantId: string | null; userId: string | null; projectId: string };

export type TakeoffLaunchCommand = {
  intentKey: string;
  /** The analysis the launch replaces; none for the affaire's first analysis (intent `initial`). */
  predecessorJobId: string | null;
  planSetId: string;
  preparationRevision: number;
};

type Entry = { outstanding: TakeoffLaunchCommand | null; settled: string[] };

const PREFIX = "mergeone:takeoff-launch-command:v2:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The keys answered lately, kept so that a late write of another tab never revives one. */
const SETTLED_KEPT = 20;
// Only when the browser keeps nothing (storage refused): the command then outlives the dialogue, not the page.
const inPage = new Map<string, Entry>();

function browserStorage(): Storage | null {
  try {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    storage?.getItem(PREFIX);
    return storage;
  } catch {
    return null;
  }
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a text, in hexadecimal: synchronous, and available outside a secure context (unlike crypto.subtle). */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, Math.floor((bytes.length * 8) / 0x100000000));
  view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  const hash = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotate(w[i - 15]!, 7) ^ rotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotate(w[i - 2]!, 17) ^ rotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as number[];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h! + (rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d! + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i]! + value!) >>> 0; });
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

function entryName(scope: TakeoffLaunchScope) {
  return PREFIX + sha256Hex([scope.tenantId ?? "-", scope.userId ?? "-", scope.projectId].join("|"));
}

function toCommand(value: unknown): TakeoffLaunchCommand | null {
  const entry = value as Partial<TakeoffLaunchCommand> | null;
  return entry && typeof entry.intentKey === "string" && UUID.test(entry.intentKey) && typeof entry.planSetId === "string"
    && (entry.predecessorJobId === null || typeof entry.predecessorJobId === "string")
    && typeof entry.preparationRevision === "number" && Number.isInteger(entry.preparationRevision)
    ? { intentKey: entry.intentKey, predecessorJobId: entry.predecessorJobId, planSetId: entry.planSetId,
      preparationRevision: entry.preparationRevision }
    : null;
}

function readEntry(storage: Storage | null, name: string): Entry {
  if (!storage) return inPage.get(name) ?? { outstanding: null, settled: [] };
  try {
    const parsed = JSON.parse(storage.getItem(name) ?? "null") as Partial<Entry> | null;
    const settled = Array.isArray(parsed?.settled) ? parsed.settled.filter((key): key is string => typeof key === "string") : [];
    const outstanding = toCommand(parsed?.outstanding ?? null);
    return { outstanding: outstanding && !settled.includes(outstanding.intentKey) ? outstanding : null, settled };
  } catch {
    return { outstanding: null, settled: [] };
  }
}

function writeEntry(storage: Storage | null, name: string, entry: Entry) {
  if (!storage) {
    inPage.set(name, entry);
    return;
  }
  try {
    if (!entry.outstanding && entry.settled.length === 0) storage.removeItem(name);
    else storage.setItem(name, JSON.stringify(entry));
  } catch {
    // Nothing kept: the next click is a new command.
  }
}

/** The member's command on this affaire whose answer is unknown, if any: it is sent again before anything new. */
export function readOutstandingTakeoffLaunch(scope: TakeoffLaunchScope): TakeoffLaunchCommand | null {
  return readEntry(browserStorage(), entryName(scope)).outstanding;
}

/** A new command, kept until its answer. */
export function beginTakeoffLaunch(scope: TakeoffLaunchScope, command: Omit<TakeoffLaunchCommand, "intentKey">): TakeoffLaunchCommand {
  const storage = browserStorage();
  const name = entryName(scope);
  const begun = { ...command, intentKey: crypto.randomUUID() };
  writeEntry(storage, name, { outstanding: begun, settled: readEntry(storage, name).settled });
  return begun;
}

/** The command was answered: it is never sent again, here or in another tab. */
export function settleTakeoffLaunch(scope: TakeoffLaunchScope, intentKey: string) {
  const storage = browserStorage();
  const name = entryName(scope);
  const entry = readEntry(storage, name);
  writeEntry(storage, name, {
    outstanding: entry.outstanding?.intentKey === intentKey ? null : entry.outstanding,
    settled: [...entry.settled.filter((key) => key !== intentKey), intentKey].slice(-SETTLED_KEPT),
  });
}
