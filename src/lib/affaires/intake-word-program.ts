/** Trusted child program. File bytes arrive only on stdin; it receives no application secrets. */
export const WORD_READER_PROGRAM = String.raw`
const { Buffer } = require('node:buffer');
const fail = code => { process.stdout.write(JSON.stringify({ error: code })); };
function validateOle(bytes) {
  const invalid = () => { throw new Error('WORD_INVALID'); };
  if (bytes.length < 512 || ![9, 12].includes(bytes.readUInt16LE(30)) || bytes.readUInt16LE(32) !== 6) invalid();
  if (bytes.readUInt32LE(56) !== 4096) invalid();
  const size = 2 ** bytes.readUInt16LE(30);
  const count = Math.floor(bytes.length / size) - 1;
  if (count < 1 || bytes.length % size) invalid();
  const sector = id => {
    if (!Number.isInteger(id) || id < 0 || id >= count) invalid();
    return bytes.subarray((id + 1) * size, (id + 2) * size);
  };
  const fatCount = bytes.readUInt32LE(44), miniCount = bytes.readUInt32LE(64), difCount = bytes.readUInt32LE(72);
  if (!fatCount || fatCount > count || miniCount > count || difCount > count) invalid();
  const fatIds = [];
  for (let i = 0; i < Math.min(109, fatCount); i++) fatIds.push(bytes.readInt32LE(76 + i * 4));
  let dif = bytes.readInt32LE(68);
  const visited = new Set();
  for (let i = 0; i < difCount; i++) {
    if (visited.has(dif)) invalid(); visited.add(dif);
    const block = sector(dif);
    for (let j = 0; j < size / 4 - 1 && fatIds.length < fatCount; j++) fatIds.push(block.readInt32LE(j * 4));
    dif = block.readInt32LE(size - 4);
  }
  if (fatIds.length !== fatCount || new Set(fatIds).size !== fatIds.length) invalid();
  const table = [];
  for (const id of fatIds) { const block = sector(id); for (let i = 0; i < size; i += 4) table.push(block.readInt32LE(i)); }
  if (table.length < count) invalid();
  // Every chain used by the parser is finite and bounded by real file sectors.
  const colors = new Uint8Array(count);
  for (let start = 0; start < count; start++) {
    let id = start; const path = [];
    while (id >= 0) {
      if (id >= count || colors[id] === 1) invalid();
      if (colors[id] === 2) break;
      colors[id] = 1; path.push(id); id = table[id];
    }
    if (id < -4) invalid();
    for (const item of path) colors[item] = 2;
  }
  const chain = start => {
    const result = []; let id = start;
    while (id >= 0) { if (id >= count || result.length >= count) invalid(); result.push(id); id = table[id]; }
    return result;
  };
  const directory = Buffer.concat(chain(bytes.readInt32LE(48)).map(sector));
  let miniRoot = null;
  for (let i = 0; i + 128 <= directory.length; i += 128) {
    if (directory[i + 66] === 5) miniRoot = { size: directory.readUInt32LE(i + 120), chain: chain(directory.readInt32LE(i + 116)) };
  }
  for (let i = 0; i + 128 <= directory.length; i += 128) {
    const nameLength = directory.readUInt16LE(i + 64);
    if (nameLength > 64) invalid();
    const name = directory.toString('utf16le', i, i + Math.max(0, nameLength - 2));
    const kind = directory[i + 66];
    if (kind !== 2 && kind !== 5) continue;
    const streamSize = directory.readUInt32LE(i + 120);
    if (directory.readUInt32LE(i + 124) || streamSize > bytes.length) invalid();
    if (name === 'EncryptedPackage' || name === 'EncryptionInfo') throw new Error('WORD_PROTECTED');
    if (name === 'WordDocument' && streamSize >= 12) {
      const start = directory.readInt32LE(i + 116);
      let first;
      if (streamSize < 4096) {
        const offset = start * 64;
        if (!miniRoot || start < 0 || offset + 12 > miniRoot.size) invalid();
        first = sector(miniRoot.chain[Math.floor(offset / size)]).subarray(offset % size);
      } else first = sector(start);
      if (first.readUInt16LE(10) & 0x0100) throw new Error('WORD_PROTECTED');
    }
  }
}
const chunks = []; let size = 0;
process.stdin.on('data', chunk => { size += chunk.length; if (size > 10485760) process.exit(2); chunks.push(chunk); });
process.stdin.on('end', async () => {
  try {
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))) validateOle(bytes);
    const WordExtractor = require(process.argv[1]);
    const doc = await new WordExtractor().extract(bytes);
    const text = [doc.getBody(), doc.getHeaders({includeFooters:false}), doc.getFooters(),
      doc.getFootnotes(), doc.getEndnotes(), doc.getTextboxes()].filter(Boolean).join('\n').trim();
    if (!text) return fail('WORD_EMPTY');
    process.stdout.write(JSON.stringify({ text: text.slice(0,12000), truncated: text.length > 12000 }));
  } catch (error) {
    fail(['WORD_INVALID','WORD_PROTECTED'].includes(error.message) ? error.message : 'WORD_INVALID');
  }
});
`;
