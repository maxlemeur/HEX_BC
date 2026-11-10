// Fictional DWG and RVT files for the tests: only the parts the readers look
// at are written, the rest is zeros.

const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value >>> 0, true);

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: number[]): number[] {
  const length = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
  return [...length, ...[...type].map((letter) => letter.charCodeAt(0)), ...data, 0xde, 0xad, 0xbe, 0xef];
}

/** A PNG in its chunks (the pixels are not real): `size` bytes of image data. */
export function pngBytes(size = 16): Uint8Array {
  const data = Array.from({ length: size }, (_, index) => (index * 7) & 255);
  return new Uint8Array([...PNG_SIGNATURE, ...chunk("IHDR", [0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0]), ...chunk("IDAT", data), ...chunk("IEND", [])]);
}

/** A device-independent bitmap as a DWG holds it: header, palette, pixels, no file header. */
export function dibBytes(bitCount: 8 | 24, width = 4, height = 4, colorsUsed = 0): Uint8Array {
  const palette = bitCount === 8 ? 4 * (colorsUsed || 256) : 0;
  const row = Math.ceil((width * bitCount) / 32) * 4;
  const bytes = new Uint8Array(40 + palette + row * height);
  const view = new DataView(bytes.buffer);
  u32(view, 0, 40); u32(view, 4, width); u32(view, 8, height);
  view.setUint16(12, 1, true); view.setUint16(14, bitCount, true);
  u32(view, 20, row * height); u32(view, 32, colorsUsed);
  bytes.fill(0x55, 40 + palette);
  return bytes;
}

export const DWG_SENTINEL = [0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b];

export type DwgFixture = {
  version?: string;
  /** Images of the preview section, by their code: 1 header, 2 bitmap, 3 metafile, 6 PNG. */
  images?: { code: number; bytes: Uint8Array }[];
  /** Address written in the header: "sentinel" (the true one) by default, or any number. */
  address?: "sentinel" | number;
  /** Bytes between the header and the preview. */
  padding?: number;
  /** Cuts the file to this length. */
  cut?: number;
};

export function dwgBytes(fixture: DwgFixture = {}): Uint8Array {
  const images = fixture.images ?? [];
  const at = 0x80 + (fixture.padding ?? 0);
  const table = at + 16 + 4 + 1 + 9 * images.length;
  const total = table + images.reduce((sum, image) => sum + image.bytes.length, 0) + 16;
  const bytes = new Uint8Array(fixture.images ? total : 0x80);
  const view = new DataView(bytes.buffer);
  bytes.set([...(fixture.version ?? "AC1032")].map((letter) => letter.charCodeAt(0)));
  if (!fixture.images) return bytes;
  u32(view, 0x0d, fixture.address === undefined || fixture.address === "sentinel" ? at : fixture.address);
  bytes.set(DWG_SENTINEL, at);
  u32(view, at + 16, total - at - 16 - 4 - 16);
  bytes[at + 20] = images.length;
  let data = table;
  images.forEach((image, index) => {
    const entry = at + 21 + 9 * index;
    bytes[entry] = image.code;
    u32(view, entry + 1, data); u32(view, entry + 5, image.bytes.length);
    bytes.set(image.bytes, data);
    data += image.bytes.length;
  });
  return fixture.cut === undefined ? bytes : bytes.slice(0, fixture.cut);
}

export const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe, FREE = 0xffffffff, FAT_SECTOR = 0xfffffffd;

export type CfbStreamFixture = { name: string; bytes: Uint8Array };

/**
 * A compound file (the container of an RVT): streams under 4 096 bytes go to the mini stream, the others
 * to sectors of their own. `sectorShift` 9 writes 512-byte sectors, 12 the 4 096-byte ones Revit uses.
 */
export function cfbBytes(streams: CfbStreamFixture[], sectorShift: 9 | 12 = 9): Uint8Array {
  const sector = 1 << sectorShift, perFat = sector / 4, perDir = sector / 128;
  const small = streams.filter((stream) => stream.bytes.length < 4096), large = streams.filter((stream) => stream.bytes.length >= 4096);
  const miniSectors = small.map((stream) => Math.ceil(stream.bytes.length / 64));
  const miniCount = miniSectors.reduce((sum, count) => sum + count, 0);
  const dirSectors = Math.ceil((streams.length + 1) / perDir);
  const miniFatSectors = Math.ceil(miniCount / perFat);
  const containerSectors = Math.ceil((miniCount * 64) / sector);
  const largeSectors = large.map((stream) => Math.ceil(stream.bytes.length / sector));
  const body = dirSectors + miniFatSectors + containerSectors + largeSectors.reduce((sum, count) => sum + count, 0);
  let fatSectors = 1;
  while (fatSectors * perFat < fatSectors + body) fatSectors += 1;
  if (fatSectors > 109) throw new Error("fixture too large for the header's sector list");

  const bytes = new Uint8Array((1 + fatSectors + body) * sector);
  const view = new DataView(bytes.buffer);
  const offset = (index: number) => (index + 1) * sector;
  const fat = new Uint32Array(fatSectors * perFat).fill(FREE);
  const chain = (first: number, count: number) => { for (let index = 0; index < count; index += 1) fat[first + index] = index === count - 1 ? END : first + index + 1; };
  for (let index = 0; index < fatSectors; index += 1) fat[index] = FAT_SECTOR;
  const firstDir = fatSectors, firstMiniFat = firstDir + dirSectors, firstContainer = firstMiniFat + miniFatSectors;
  chain(firstDir, dirSectors); chain(firstMiniFat, miniFatSectors); chain(firstContainer, containerSectors);

  bytes.set(CFB_SIGNATURE);
  view.setUint16(0x18, 0x3e, true); view.setUint16(0x1a, sectorShift === 9 ? 3 : 4, true); view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, sectorShift, true); view.setUint16(0x20, 6, true);
  u32(view, 0x2c, fatSectors); u32(view, 0x30, firstDir); u32(view, 0x38, 4096);
  u32(view, 0x3c, miniFatSectors > 0 ? firstMiniFat : END); u32(view, 0x40, miniFatSectors);
  u32(view, 0x44, END); u32(view, 0x48, 0);
  for (let index = 0; index < 109; index += 1) u32(view, 0x4c + 4 * index, index < fatSectors ? index : FREE);

  const entry = (id: number, name: string, type: number, start: number, size: number, right: number, child: number) => {
    const at = offset(firstDir + Math.floor(id / perDir)) + 128 * (id % perDir);
    [...name].forEach((letter, index) => view.setUint16(at + 2 * index, letter.charCodeAt(0), true));
    view.setUint16(at + 0x40, 2 * (name.length + 1), true);
    bytes[at + 0x42] = type; bytes[at + 0x43] = 1;
    u32(view, at + 0x44, FREE); u32(view, at + 0x48, right); u32(view, at + 0x4c, child);
    u32(view, at + 0x74, start); u32(view, at + 0x78, size);
  };
  entry(0, "Root Entry", 5, containerSectors > 0 ? firstContainer : END, miniCount * 64, FREE, streams.length > 0 ? 1 : FREE);

  let mini = 0, next = firstContainer + containerSectors;
  const miniFat = new Uint32Array(miniFatSectors * perFat).fill(FREE);
  streams.forEach((stream, index) => {
    const right = index + 1 < streams.length ? index + 2 : FREE;
    if (stream.bytes.length < 4096) {
      const count = Math.ceil(stream.bytes.length / 64);
      for (let step = 0; step < count; step += 1) miniFat[mini + step] = step === count - 1 ? END : mini + step + 1;
      bytes.set(stream.bytes, offset(firstContainer) + 64 * mini);
      entry(index + 1, stream.name, 2, count > 0 ? mini : END, stream.bytes.length, right, FREE);
      mini += count;
    } else {
      const count = Math.ceil(stream.bytes.length / sector);
      chain(next, count);
      bytes.set(stream.bytes, offset(next));
      entry(index + 1, stream.name, 2, next, stream.bytes.length, right, FREE);
      next += count;
    }
  });
  for (let index = dirSectors * perDir - 1; index > streams.length; index -= 1) entry(index, "", 0, 0, 0, FREE, FREE);

  miniFat.forEach((value, index) => u32(view, offset(firstMiniFat) + 4 * index, value));
  fat.forEach((value, index) => u32(view, offset(0) + 4 * index, value));
  return bytes;
}

/** The « BasicFileInfo » stream of a Revit file: a binary head, then its text in UTF-16. */
export function basicFileInfo(text: string, head = 14): Uint8Array {
  const bytes = new Uint8Array(head + 2 * text.length);
  bytes.fill(0x03, 0, head);
  const view = new DataView(bytes.buffer);
  [...text].forEach((letter, index) => view.setUint16(head + 2 * index, letter.charCodeAt(0), true));
  return bytes;
}

/** The « RevitPreview4.0 » stream: a head Revit writes, then the PNG. */
export function revitPreview(png: Uint8Array, head = 300, tail = 0): Uint8Array {
  const bytes = new Uint8Array(head + png.length + tail);
  bytes.fill(0x62, 0, head);
  bytes.set(png, head);
  return bytes;
}
