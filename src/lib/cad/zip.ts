// A zip archive read by its directory, which sits at the end of the file: the
// names, the sizes and the place of each entry. An entry is unfolded only when
// asked for, and never past the size it is asked under: the archive comes from
// outside and may announce anything.

export type ZipArchive = {
  names: string[];
  /** The size the directory announces for that entry once unfolded; null when it is absent. */
  size(name: string): number | null;
  /** The entry of that name; null when it is absent, larger than `maxBytes`, encrypted, damaged or packed in a way that is not read. */
  read(name: string, maxBytes: number): Promise<Uint8Array | null>;
};

type ZipEntry = { name: string; method: number; packedSize: number; size: number; offset: number; encrypted: boolean };

const LOCAL_ENTRY = 0x04034b50, DIRECTORY_ENTRY = 0x02014b50, DIRECTORY_END = 0x06054b50;
const END_SIZE = 22, MAX_COMMENT = 0xffff;
const STORED = 0, DEFLATED = 8;
/** Past this a field holds a placeholder: the true value is in a zip64 record, which is not read. */
const ZIP64 = 0xffffffff;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Unfolds deflated data into exactly `size` bytes; null when it is damaged or unfolds into more or less. */
async function inflate(packed: Uint8Array, size: number): Promise<Uint8Array | null> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(packed.slice());
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const out = new Uint8Array(size);
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (filled + value.length > size) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      out.set(value, filled);
      filled += value.length;
    }
  } catch {
    return null;
  }
  return filled === size ? out : null;
}

/** Null when the bytes are not a zip whose directory can be read whole. */
export function openZip(bytes: Uint8Array): ZipArchive | null {
  if (!isZip(bytes) || bytes.length < END_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record closes the file, or stands before a comment.
  let end = -1;
  for (let at = bytes.length - END_SIZE, floor = Math.max(0, at - MAX_COMMENT); at >= floor; at -= 1) {
    if (view.getUint32(at, true) === DIRECTORY_END) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directory = view.getUint32(end + 16, true);
  if (count === 0xffff || directory === ZIP64 || directory + directorySize > end) return null;

  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, ZipEntry>();
  for (let at = directory, index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== DIRECTORY_ENTRY) return null;
    const nameLength = view.getUint16(at + 28, true), next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > end) return null;
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    // A name met twice keeps its first entry: what the directory lists first is what is read.
    if (!entries.has(name)) {
      entries.set(name, {
        name,
        encrypted: (view.getUint16(at + 8, true) & 1) === 1,
        method: view.getUint16(at + 10, true),
        packedSize: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        offset: view.getUint32(at + 42, true),
      });
    }
    at = next;
  }

  return {
    names: [...entries.keys()],
    size: (name) => entries.get(name)?.size ?? null,
    async read(name, maxBytes) {
      const entry = entries.get(name);
      if (!entry || entry.encrypted || entry.size > maxBytes || entry.size === ZIP64 || entry.packedSize === ZIP64 || entry.offset === ZIP64) return null;
      if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOCAL_ENTRY) return null;
      const data = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
      if (data + entry.packedSize > bytes.length) return null;
      const packed = bytes.subarray(data, data + entry.packedSize);
      if (entry.method === STORED) return entry.packedSize === entry.size ? packed.slice() : null;
      return entry.method === DEFLATED ? inflate(packed, entry.size) : null;
    },
  };
}
