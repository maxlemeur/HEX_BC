// Compound File Binary reader (the container of Revit and of the old Office
// formats), kept to what the summary of an RVT needs: the streams at the root,
// read by name. Every address comes from the file and is checked against it,
// and no chain is followed through the same sector twice.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe, NO_STREAM = 0xffffffff, MAX_REGULAR_SECTOR = 0xfffffffa;
const HEADER_FAT_ENTRIES = 109, ENTRY_SIZE = 128, MINI_SECTOR = 64, STREAM = 2, ROOT = 5;
/** Directory sectors read at most: a Revit file holds a few hundred entries. */
const MAX_DIRECTORY_SECTORS = 4096;

export type CfbFile = {
  /** Streams at the root of the file, in the order of its directory. */
  names: string[];
  /** The first `maxBytes` of a root stream (name compared without case); null when it is missing or cannot be followed. */
  read(name: string, maxBytes: number): Uint8Array | null;
};

/** The file opens with the signature of a compound file (which says nothing of its state). */
export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= SIGNATURE.length && SIGNATURE.every((value, index) => bytes[index] === value);
}

export function openCfb(bytes: Uint8Array): CfbFile | null {
  if (!isCfb(bytes) || bytes.length < 512) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shift = view.getUint16(0x1e, true);
  if ((shift !== 9 && shift !== 12) || view.getUint16(0x20, true) !== 6) return null;
  const sectorSize = 1 << shift, perSector = sectorSize / 4;
  const sectorCount = Math.floor(bytes.length / sectorSize);
  const cutoff = view.getUint32(0x38, true);
  /** Offset of a sector in the file, -1 when the file does not hold it whole. */
  const offsetOf = (sector: number) => {
    if (sector > MAX_REGULAR_SECTOR) return -1;
    const offset = (sector + 1) * sectorSize;
    return offset + sectorSize <= bytes.length ? offset : -1;
  };

  // Sectors of the allocation table: 109 in the header, the rest chained.
  const fatSectors: number[] = [];
  for (let index = 0; index < HEADER_FAT_ENTRIES; index += 1) {
    const sector = view.getUint32(0x4c + 4 * index, true);
    if (sector <= MAX_REGULAR_SECTOR) fatSectors.push(sector);
  }
  for (let sector = view.getUint32(0x44, true), steps = 0; sector <= MAX_REGULAR_SECTOR; steps += 1) {
    const offset = offsetOf(sector);
    if (offset < 0 || steps > sectorCount) return null;
    for (let index = 0; index < perSector - 1; index += 1) {
      const entry = view.getUint32(offset + 4 * index, true);
      if (entry <= MAX_REGULAR_SECTOR) fatSectors.push(entry);
    }
    sector = view.getUint32(offset + 4 * (perSector - 1), true);
  }

  const next = (sector: number) => {
    const offset = offsetOf(fatSectors[Math.floor(sector / perSector)] ?? NO_STREAM);
    return offset < 0 ? NO_STREAM : view.getUint32(offset + 4 * (sector % perSector), true);
  };
  /** Sectors of a chain, null when it leaves the file, loops or is longer than `most`. */
  const chain = (first: number, most: number): number[] | null => {
    const sectors: number[] = [];
    for (let sector = first; sector !== END_OF_CHAIN; sector = next(sector)) {
      if (offsetOf(sector) < 0 || sectors.length >= most) return null;
      sectors.push(sector);
    }
    return sectors;
  };

  const directory = chain(view.getUint32(0x30, true), Math.min(sectorCount, MAX_DIRECTORY_SECTORS));
  if (directory === null || directory.length === 0) return null;
  const perDirectory = sectorSize / ENTRY_SIZE, entryCount = directory.length * perDirectory;
  const entryAt = (id: number) => offsetOf(directory[Math.floor(id / perDirectory)]) + ENTRY_SIZE * (id % perDirectory);
  if (bytes[entryAt(0) + 0x42] !== ROOT) return null;

  // The root's children are a binary tree of siblings: walked in order, each entry once.
  const entries = new Map<string, number>(), names: string[] = [];
  const seen = new Set<number>(), pending: number[] = [];
  let current = view.getUint32(entryAt(0) + 0x4c, true);
  while (pending.length > 0 || (current < entryCount && !seen.has(current))) {
    if (current < entryCount && !seen.has(current)) {
      seen.add(current);
      pending.push(current);
      current = view.getUint32(entryAt(current) + 0x44, true);
      continue;
    }
    const id = pending.pop() as number, at = entryAt(id);
    if (bytes[at + 0x42] === STREAM) {
      const length = Math.min(Math.max(view.getUint16(at + 0x40, true) - 2, 0), 62) / 2;
      let name = "";
      for (let index = 0; index < length; index += 1) name += String.fromCharCode(view.getUint16(at + 2 * index, true));
      if (!entries.has(name.toUpperCase())) { entries.set(name.toUpperCase(), id); names.push(name); }
    }
    current = view.getUint32(at + 0x48, true);
  }

  // Small streams sit in the root's own stream, cut in 64-byte sectors with their own table.
  let miniTable: number[] | null | undefined, container: number[] | null | undefined;
  const readMini = (first: number, size: number): Uint8Array | null => {
    miniTable ??= chain(view.getUint32(0x3c, true), sectorCount);
    container ??= chain(view.getUint32(entryAt(0) + 0x74, true), sectorCount);
    if (!miniTable || !container) return null;
    const out = new Uint8Array(size), limit = miniTable.length * perSector, visited = new Set<number>();
    let sector = first;
    for (let done = 0; done < size;) {
      const home = container[Math.floor((sector * MINI_SECTOR) / sectorSize)];
      if (sector >= limit || home === undefined || visited.has(sector)) return null;
      visited.add(sector);
      const from = offsetOf(home) + ((sector * MINI_SECTOR) % sectorSize), take = Math.min(MINI_SECTOR, size - done);
      out.set(bytes.subarray(from, from + take), done);
      done += take;
      sector = view.getUint32(offsetOf(miniTable[Math.floor(sector / perSector)]) + 4 * (sector % perSector), true);
    }
    return out;
  };

  const readRegular = (first: number, size: number): Uint8Array | null => {
    const out = new Uint8Array(size), visited = new Set<number>();
    let sector = first;
    for (let done = 0; done < size;) {
      const from = offsetOf(sector);
      if (from < 0 || visited.has(sector)) return null;
      visited.add(sector);
      const take = Math.min(sectorSize, size - done);
      out.set(bytes.subarray(from, from + take), done);
      done += take;
      sector = next(sector);
    }
    return out;
  };

  return {
    names,
    read(name, maxBytes) {
      const id = entries.get(name.toUpperCase());
      if (id === undefined) return null;
      const at = entryAt(id), size = view.getUint32(at + 0x78, true), first = view.getUint32(at + 0x74, true);
      // Version 4 files give sizes on 64 bits: beyond 4 GiB the stream is not one this reader follows.
      if (shift === 12 && view.getUint32(at + 0x7c, true) !== 0) return null;
      const wanted = Math.min(size, Math.max(0, Math.floor(maxBytes)));
      return size < cutoff ? readMini(first, wanted) : readRegular(first, wanted);
    },
  };
}
